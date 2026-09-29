import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guards the mistake that took /beer and /store down in production:
 *
 *   <Picker hrefFor={(slug) => `/beer/${slug}`} />     // Server Component → Client Component
 *
 * React cannot serialise a function across that boundary, so the page threw at
 * render time. `tsc`, `eslint` and `next build` all passed — the failure only
 * existed when a request came in. This test reads the source instead: in every
 * file that is NOT a Client Component, any component imported from a "use client"
 * module must not be handed a function (directly, or inside an object/array
 * literal, or as render-prop children). Server Actions ("use server") are fine.
 */

const SRC = join(import.meta.dirname, "..", "src");

type Violation = { file: string; line: number; component: string; prop: string };

const has = (text: string, directive: string) => {
  const source = ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === directive) return true;
  }
  return false;
};

function resolveModule(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;
  for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Third-party components that are Client Components and take event handlers. */
const EXTERNAL_CLIENT = new Set(["next/link"]);

export function findBoundaryViolations(fileName: string, text: string, readModule: (path: string) => string | null): Violation[] {
  if (has(text, "use client")) return []; // client → client is unrestricted

  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const clientNames = new Set<string>();
  const serverActionNames = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) continue;
    const names = [clause.name?.text, ...(clause.namedBindings && ts.isNamedImports(clause.namedBindings) ? clause.namedBindings.elements.map((e) => e.name.text) : [])].filter(
      (n): n is string => Boolean(n),
    );

    if (EXTERNAL_CLIENT.has(specifier)) {
      names.forEach((n) => clientNames.add(n));
      continue;
    }
    const path = resolveModule(fileName, specifier);
    const contents = path ? readModule(path) : null;
    if (contents === null) continue;
    if (has(contents, "use client")) names.forEach((n) => clientNames.add(n));
    if (has(contents, "use server")) names.forEach((n) => serverActionNames.add(n));
  }

  // Functions declared in this file, so `onClick={handle}` is caught too.
  const localFunctions = new Set<string>();
  const inlineServerAction = (fn: ts.Node) =>
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn) || ts.isFunctionDeclaration(fn)) &&
    !!fn.body &&
    ts.isBlock(fn.body) &&
    fn.body.statements[0] !== undefined &&
    ts.isExpressionStatement(fn.body.statements[0]) &&
    ts.isStringLiteral(fn.body.statements[0].expression) &&
    fn.body.statements[0].expression.text === "use server";

  const collect = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && !inlineServerAction(node)) localFunctions.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
      !inlineServerAction(node.initializer)
    ) {
      localFunctions.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(source);

  const isFunctionValue = (expr: ts.Expression): boolean => {
    if (ts.isParenthesizedExpression(expr)) return isFunctionValue(expr.expression);
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) return !inlineServerAction(expr);
    if (ts.isIdentifier(expr)) return localFunctions.has(expr.text) && !serverActionNames.has(expr.text);
    if (ts.isObjectLiteralExpression(expr)) {
      return expr.properties.some(
        (p) => ts.isMethodDeclaration(p) || (ts.isPropertyAssignment(p) && isFunctionValue(p.initializer)) || (ts.isShorthandPropertyAssignment(p) && localFunctions.has(p.name.text)),
      );
    }
    if (ts.isArrayLiteralExpression(expr)) return expr.elements.some((e) => isFunctionValue(e));
    return false;
  };

  const violations: Violation[] = [];
  const report = (node: ts.Node, component: string, prop: string) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart());
    violations.push({ file: fileName, line: line + 1, component, prop });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      if (clientNames.has(tag)) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isJsxExpression(attribute.initializer)) continue;
          const value = attribute.initializer.expression;
          if (value && isFunctionValue(value)) report(attribute, tag, attribute.name.getText());
        }
        // Render-prop children: <Client>{() => …}</Client>
        const parent = node.parent;
        if (ts.isJsxElement(parent)) {
          for (const child of parent.children) {
            if (ts.isJsxExpression(child) && child.expression && isFunctionValue(child.expression)) report(child, tag, "children");
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, found);
    else if (entry.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const readFromDisk = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

describe("server → client component boundary", () => {
  it("passes no functions from a Server Component into a Client Component", () => {
    const files = tsxFiles(SRC);
    expect(files.length).toBeGreaterThan(10); // the scan must actually be scanning

    const violations = files.flatMap((file) => findBoundaryViolations(file, readFileSync(file, "utf8"), readFromDisk));
    expect(
      violations.map((v) => `${v.file.replace(SRC, "src")}:${v.line}  <${v.component} ${v.prop}={…function…}>`),
      "Functions cannot be passed from Server to Client Components — pass data (a string, a slug) or a Server Action instead",
    ).toEqual([]);
  });
});

describe("the boundary checker itself (it must not pass by doing nothing)", () => {
  const modules: Record<string, string> = {
    [join(SRC, "components", "Picker.tsx")]: `"use client";\nexport function Picker(props: object) { return null; }`,
    [join(SRC, "lib", "actions", "do.ts")]: `"use server";\nexport async function save() {}`,
  };
  const read = (path: string) => modules[path] ?? null;
  const page = join(SRC, "app", "beer", "page.tsx");

  it("catches the exact bug that broke /beer and /store", () => {
    const bad = `import { Picker } from "@/components/Picker";
      export default function Page() { return <Picker items={[]} hrefFor={(slug) => \`/beer/\${slug}\`} />; }`;
    const found = findBoundaryViolations(page, bad, read);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ component: "Picker", prop: "hrefFor" });
  });

  it("catches a local function, a function hidden in an object, and a render prop", () => {
    const bad = `import { Picker } from "@/components/Picker";
      function build() { return "x"; }
      export default function Page() {
        return (<>
          <Picker cb={build} />
          <Picker config={{ onPick: () => 1 }} />
          <Picker>{() => null}</Picker>
        </>);
      }`;
    expect(findBoundaryViolations(page, bad, read).map((v) => v.prop).sort()).toEqual(["cb", "children", "config"]);
  });

  it("allows data, mapped data, Server Actions and client-to-client props", () => {
    const good = `import { Picker } from "@/components/Picker";
      import { save } from "@/lib/actions/do";
      export default function Page({ beers }: { beers: { slug: string }[] }) {
        return (<>
          <Picker basePath="/beer" items={beers.map((b) => ({ slug: b.slug }))} />
          <Picker onSave={save} />
          <Picker onInline={async () => { "use server"; }} />
        </>);
      }`;
    expect(findBoundaryViolations(page, good, read)).toEqual([]);

    const clientFile = `"use client";\nimport { Picker } from "@/components/Picker";\nexport const X = () => <Picker cb={() => 1} />;`;
    expect(findBoundaryViolations(page, clientFile, read)).toEqual([]);
  });
});
