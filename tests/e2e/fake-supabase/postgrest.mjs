// A small PostgREST-compatible layer over PGlite, used ONLY by the local e2e
// harness (never shipped, never pointed at a real database).
//
// It exists because the app talks to Supabase exclusively through supabase-js,
// i.e. PostgREST. Running the real migrations on PGlite and translating the
// requests keeps row level security, triggers, generated columns and functions
// real — only the HTTP surface is imitated. It implements exactly the subset the
// app uses (select/embeds, eq/neq/gt/…/in/is/or, order/limit, insert/patch/
// delete, rpc) and refuses anything else loudly instead of guessing.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function ident(name) {
  if (!IDENT.test(name)) throw httpError(400, "PGRST100", `bad identifier: ${name}`);
  return `"${name}"`;
}

export function httpError(status, code, message, details = null, hint = null) {
  const error = new Error(message);
  error.status = status;
  error.body = { code, message, details, hint };
  return error;
}

// ------------------------------------------------------------------ schema --

export async function loadSchema(db) {
  const cols = await db.query(`
    select c.relname as rel, a.attname as col, format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r','v','p','m')
       and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`);

  const relations = new Map();
  for (const { rel, col, type } of cols.rows) {
    if (!relations.has(rel)) relations.set(rel, new Map());
    relations.get(rel).set(col, type);
  }

  const fks = await db.query(`
    select cl.relname as child, pl.relname as parent,
           (select array_agg(att.attname order by k.ord)
              from unnest(con.conkey) with ordinality k(attnum, ord)
              join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum) as child_cols,
           (select array_agg(att.attname order by k.ord)
              from unnest(con.confkey) with ordinality k(attnum, ord)
              join pg_attribute att on att.attrelid = con.confrelid and att.attnum = k.attnum) as parent_cols
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_class pl on pl.oid = con.confrelid
      join pg_namespace cn on cn.oid = cl.relnamespace
      join pg_namespace pn on pn.oid = pl.relnamespace
     where con.contype = 'f' and cn.nspname = 'public' and pn.nspname = 'public'`);

  const functions = await db.query(`
    select p.proname as name, p.proargnames as argnames,
           (select coalesce(array_agg(format_type(t, null) order by ord), '{}')
              from unnest(p.proargtypes::oid[]) with ordinality u(t, ord)) as argtypes,
           format_type(p.prorettype, null) as rettype,
           t.typtype as rettypetype, p.proretset as retset
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
     where n.nspname = 'public'`);

  return { relations, fks: fks.rows, functions: functions.rows };
}

// ------------------------------------------------------------------ select --

/** "a,b,beers(id,slug),alias:col" -> tree */
export function parseSelect(text) {
  const src = text && text.length ? text : "*";
  let i = 0;

  function list() {
    const items = [];
    while (i < src.length) {
      while (src[i] === " ") i++;
      if (src[i] === ")") break;
      let start = i;
      while (i < src.length && ![",", "(", ")"].includes(src[i])) i++;
      let token = src.slice(start, i).trim();
      if (src[i] === "(") {
        i++;
        const children = list();
        if (src[i] !== ")") throw httpError(400, "PGRST100", "unbalanced select");
        i++;
        const [aliasPart, rest] = token.includes(":") ? token.split(":") : [null, token];
        const [name, hint] = rest.split("!");
        items.push({ kind: "embed", name, alias: aliasPart ?? name, hint, children });
      } else if (token) {
        let alias = null;
        let cast = null;
        if (token.includes("::")) [token, cast] = token.split("::");
        if (token.includes(":")) [alias, token] = token.split(":");
        items.push({ kind: "col", name: token, alias: alias ?? token, cast });
      }
      if (src[i] === ",") i++;
    }
    return items;
  }
  return list();
}

// ----------------------------------------------------------------- filters --

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

function unquote(value) {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/\\(["\\])/g, "$1")
    : value;
}

function pgArrayLiteral(values) {
  return "{" + values.map((v) => '"' + String(v).replace(/["\\]/g, "\\$&") + '"').join(",") + "}";
}

class Params {
  constructor() {
    this.values = [];
  }
  add(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

const OPS = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

function condition(alias, columnTypes, column, operatorText, params) {
  if (!columnTypes.has(column)) {
    throw httpError(400, "42703", `column ${column} does not exist`);
  }
  const type = columnTypes.get(column);
  const col = `${alias}.${ident(column)}`;
  let negate = false;
  let rest = operatorText;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = dot === -1 ? rest : rest.slice(0, dot);
  const raw = dot === -1 ? "" : rest.slice(dot + 1);
  let sql;

  if (op === "is") {
    const v = raw.toLowerCase();
    if (!["null", "true", "false"].includes(v)) throw httpError(400, "PGRST100", `bad is.${raw}`);
    sql = `${col} is ${v}`;
  } else if (op === "in") {
    const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
    const values = splitTopLevel(inner).map((v) => unquote(v.trim()));
    sql = `${col} = any(${params.add(pgArrayLiteral(values))}::text::${type}[])`;
  } else if (op === "cs" || op === "ov") {
    // Array containment / overlap: the value is a Postgres array literal, "{a,b}".
    sql = `${col} ${op === "cs" ? "@>" : "&&"} ${params.add(unquote(raw))}::text::${type}`;
  } else if (OPS[op]) {
    sql = `${col} ${OPS[op]} ${params.add(unquote(raw))}::text::${type}`;
  } else {
    throw httpError(400, "PGRST100", `unsupported operator: ${op}`);
  }
  return negate ? `not (${sql})` : sql;
}

function logicTree(alias, columnTypes, text, params, joiner) {
  // text is the inside of or=( … ) / and=( … ) / nested or(…)/and(…)
  const clauses = splitTopLevel(text).map((part) => {
    const trimmed = part.trim();
    const nested = trimmed.match(/^(not\.)?(and|or)\((.*)\)$/s);
    if (nested) {
      const sql = `(${logicTree(alias, columnTypes, nested[3], params, nested[2])})`;
      return nested[1] ? `not ${sql}` : sql;
    }
    const first = trimmed.indexOf(".");
    return condition(alias, columnTypes, trimmed.slice(0, first), trimmed.slice(first + 1), params);
  });
  return clauses.join(joiner === "or" ? " or " : " and ");
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns", "and", "or"]);

function buildWhere(alias, columnTypes, searchParams, params) {
  const clauses = [];
  for (const [key, value] of searchParams.entries()) {
    if (key === "or" || key === "and") {
      const inner = value.replace(/^\(/, "").replace(/\)$/, "");
      clauses.push(`(${logicTree(alias, columnTypes, inner, params, key)})`);
    } else if (!RESERVED.has(key)) {
      clauses.push(condition(alias, columnTypes, key, value, params));
    }
  }
  return clauses.length ? `where ${clauses.join(" and ")}` : "";
}

function buildOrder(alias, columnTypes, order) {
  if (!order) return "";
  const parts = order.split(",").map((piece) => {
    const [column, ...mods] = piece.split(".");
    if (!columnTypes.has(column)) throw httpError(400, "42703", `column ${column} does not exist`);
    const dir = mods.includes("desc") ? "desc" : "asc";
    const nulls = mods.includes("nullsfirst") ? " nulls first" : mods.includes("nullslast") ? " nulls last" : "";
    return `${alias}.${ident(column)} ${dir}${nulls}`;
  });
  return `order by ${parts.join(", ")}`;
}

// --------------------------------------------------------- select builder --

let aliasCounter = 0;

function selectList(schema, table, alias, tree) {
  const columnTypes = schema.relations.get(table);
  if (!columnTypes) throw httpError(404, "42P01", `relation "public.${table}" does not exist`);
  const exprs = [];

  for (const item of tree) {
    if (item.kind === "col") {
      if (item.name === "*") {
        exprs.push(`${alias}.*`);
      } else {
        if (!columnTypes.has(item.name)) throw httpError(400, "42703", `column ${table}.${item.name} does not exist`);
        exprs.push(`${alias}.${ident(item.name)}${item.alias !== item.name ? ` as ${ident(item.alias)}` : ""}`);
      }
      continue;
    }

    // embedded resource: many-to-one (FK on this table) or one-to-many (FK on the other)
    const toParent = schema.fks.filter((fk) => fk.child === table && fk.parent === item.name);
    const toChildren = schema.fks.filter((fk) => fk.parent === table && fk.child === item.name);
    const inner = `e${++aliasCounter}`;
    const childTree = item.children.length ? item.children : [{ kind: "col", name: "*", alias: "*" }];

    if (toParent.length) {
      const fk = toParent[0];
      const on = fk.child_cols.map((c, n) => `${inner}.${ident(fk.parent_cols[n])} = ${alias}.${ident(c)}`).join(" and ");
      const cols = selectList(schema, item.name, inner, childTree);
      exprs.push(
        `(select to_jsonb(_x${inner}) from (select ${cols} from public.${ident(item.name)} ${inner} where ${on} limit 1) _x${inner}) as ${ident(item.alias)}`,
      );
    } else if (toChildren.length) {
      const fk = toChildren[0];
      const on = fk.child_cols.map((c, n) => `${inner}.${ident(c)} = ${alias}.${ident(fk.parent_cols[n])}`).join(" and ");
      const cols = selectList(schema, item.name, inner, childTree);
      exprs.push(
        `coalesce((select jsonb_agg(to_jsonb(_x${inner})) from (select ${cols} from public.${ident(item.name)} ${inner} where ${on}) _x${inner}), '[]'::jsonb) as ${ident(item.alias)}`,
      );
    } else {
      throw httpError(400, "PGRST200", `Could not find a relationship between '${table}' and '${item.name}'`);
    }
  }
  return exprs.join(", ");
}

// ------------------------------------------------------------ the handler --

/**
 * @param {import("@electric-sql/pglite").PGlite} db
 * @param {{ method:string, table:string|null, rpc:string|null, searchParams:URLSearchParams,
 *           headers:Record<string,string>, body:any, claims:{role:string, sub:string|null} }} req
 */
export async function handleRest(db, schema, req) {
  const { method, searchParams, headers, body, claims } = req;
  const wantsObject = (headers.accept ?? "").includes("application/vnd.pgrst.object+json");
  const prefer = headers.prefer ?? "";
  const wantsRepresentation = prefer.includes("return=representation");

  return inRole(db, claims, async (tx) => {
    if (req.rpc) return rpc(tx, schema, req.rpc, body ?? {});

    const table = req.table;
    const columnTypes = schema.relations.get(table);
    if (!columnTypes) throw httpError(404, "42P01", `Could not find the table 'public.${table}' in the schema cache`);
    const params = new Params();
    const alias = "t";

    if (method === "GET" || method === "HEAD") {
      const tree = parseSelect(searchParams.get("select"));
      const cols = selectList(schema, table, alias, tree);
      const where = buildWhere(alias, columnTypes, searchParams, params);
      const order = buildOrder(alias, columnTypes, searchParams.get("order"));
      const limit = searchParams.get("limit") ? `limit ${Number(searchParams.get("limit"))}` : "";
      const offset = searchParams.get("offset") ? `offset ${Number(searchParams.get("offset"))}` : "";
      const sql = `select coalesce(jsonb_agg(to_jsonb(_r)), '[]'::jsonb) as rows
                     from (select ${cols} from public.${ident(table)} ${alias} ${where} ${order} ${limit} ${offset}) _r`;
      const { rows } = await tx.query(sql, params.values);
      return shapeRows(rows[0].rows, wantsObject, 200);
    }

    if (method === "POST") {
      const records = Array.isArray(body) ? body : [body];
      const keys = [...new Set(records.flatMap((r) => Object.keys(r)))];
      for (const key of keys) if (!columnTypes.has(key)) throw httpError(400, "PGRST204", `Could not find the '${key}' column of '${table}' in the schema cache`);
      const colList = keys.map(ident).join(", ");
      const sql = `insert into public.${ident(table)} (${colList})
                   select ${colList} from jsonb_populate_recordset(null::public.${ident(table)}, ${params.add(JSON.stringify(records))}::text::jsonb)
                   ${wantsRepresentation ? `returning to_jsonb(public.${ident(table)}.*) as row` : ""}`;
      const result = await tx.query(sql, params.values);
      if (!wantsRepresentation) return { status: 201, json: null };
      return shapeRows(result.rows.map((r) => r.row), wantsObject, 201);
    }

    if (method === "PATCH") {
      const keys = Object.keys(body ?? {});
      if (!keys.length) throw httpError(400, "PGRST100", "empty update body");
      for (const key of keys) if (!columnTypes.has(key)) throw httpError(400, "PGRST204", `Could not find the '${key}' column of '${table}' in the schema cache`);
      const setList = keys.map((k) => `${ident(k)} = _v.${ident(k)}`).join(", ");
      const bodyParam = params.add(JSON.stringify(body));
      const where = buildWhere(alias, columnTypes, searchParams, params);
      const sql = `update public.${ident(table)} ${alias} set ${setList}
                     from (select * from jsonb_populate_record(null::public.${ident(table)}, ${bodyParam}::text::jsonb)) _v
                     ${where}
                     ${wantsRepresentation ? `returning to_jsonb(${alias}.*) as row` : ""}`;
      const result = await tx.query(sql, params.values);
      if (!wantsRepresentation) return { status: 204, json: null };
      return shapeRows(result.rows.map((r) => r.row), wantsObject, 200);
    }

    if (method === "DELETE") {
      const where = buildWhere(alias, columnTypes, searchParams, params);
      const sql = `delete from public.${ident(table)} ${alias} ${where}
                   ${wantsRepresentation ? `returning to_jsonb(${alias}.*) as row` : ""}`;
      const result = await tx.query(sql, params.values);
      if (!wantsRepresentation) return { status: 204, json: null };
      return shapeRows(result.rows.map((r) => r.row), wantsObject, 200);
    }

    throw httpError(405, "PGRST117", `unsupported method ${method}`);
  });
}

function shapeRows(rows, wantsObject, status) {
  if (!wantsObject) return { status, json: rows };
  if (rows.length !== 1) {
    throw httpError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`);
  }
  return { status, json: rows[0] };
}

async function rpc(tx, schema, name, args) {
  const fn = schema.functions.find((f) => f.name === name);
  if (!fn) throw httpError(404, "PGRST202", `Could not find the function public.${name} in the schema cache`);
  const params = new Params();
  const names = fn.argnames ?? [];
  const given = Object.keys(args);
  const pieces = given.map((key) => {
    const at = names.indexOf(key);
    if (at === -1) throw httpError(404, "PGRST202", `Could not find the function public.${name}(${given.join(", ")}) in the schema cache`);
    const type = fn.argtypes[at];
    const value = args[key];
    const text = value === null ? null : Array.isArray(value) ? pgArrayLiteral(value) : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `${ident(key)} := ${params.add(text)}::text::${type}`;
  });
  const call = `public.${ident(name)}(${pieces.join(", ")})`;

  if (fn.rettype === "void") {
    await tx.query(`select ${call}`, params.values);
    return { status: 204, json: null };
  }
  if (fn.rettypetype === "c" || fn.retset) {
    const { rows } = await tx.query(`select coalesce(jsonb_agg(to_jsonb(_f)), '[]'::jsonb) as rows from ${call} _f`, params.values);
    return { status: 200, json: fn.retset ? rows[0].rows : rows[0].rows[0] ?? null };
  }
  const { rows } = await tx.query(`select ${call} as v`, params.values);
  return { status: 200, json: rows[0].v };
}

// ------------------------------------------------------------------- roles --

/** @type {Promise<any>} */
let queue = Promise.resolve();

/** PGlite is one connection: serialise, and give each request its own role/claims. */
function inRole(db, claims, work) {
  const run = queue.then(async () => {
    await db.exec("begin");
    try {
      await db.exec(`set local role ${claims.role}`);
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [claims.sub ?? ""]);
      await db.query("select set_config('request.jwt.claim.role', $1, true)", [claims.role]);
      const result = await work(db);
      await db.exec("commit");
      return result;
    } catch (error) {
      await db.exec("rollback").catch(() => undefined);
      throw pgToHttp(error);
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export function runExclusive(work) {
  const run = queue.then(work);
  queue = run.catch(() => undefined);
  return run;
}

function pgToHttp(error) {
  if (error.status && error.body) return error;
  const code = error.code ?? "XX000";
  const status =
    code === "42501" ? 403 : code === "23505" ? 409 : code.startsWith("23") ? 409 : code === "P0002" ? 404 : 400;
  const wrapped = new Error(error.message);
  wrapped.status = status;
  wrapped.body = { code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null };
  return wrapped;
}
