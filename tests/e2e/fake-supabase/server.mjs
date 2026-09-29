// Local stand-in for the Supabase HTTP API, for e2e tests only.
//
//   node tests/e2e/fake-supabase/server.mjs            # listens on 127.0.0.1:54321
//
// REST  = PostgREST subset over PGlite running the repo's real migrations.
// AUTH  = GoTrue subset: anonymous sign-up, password sign-in, refresh, /user.
// It is bound to 127.0.0.1 and refuses to start if pointed at anything else,
// because /__test/sql executes arbitrary SQL as a superuser.

import { createServer } from "node:http";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { handleRest, httpError, loadSchema, runExclusive } from "./postgrest.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..");
export const ANON_KEY = "fake-anon-key";
export const SERVICE_KEY = "fake-service-role-key";
const JWT_SECRET = "fake-jwt-secret-not-for-anything-real";

// ---------------------------------------------------------------- database --

export async function createDatabase({ extraSql = [] } = {}) {
  const db = new PGlite();
  await db.exec(readFileSync(join(ROOT, "tests", "sql", "bootstrap.sql"), "utf8"));
  const dir = join(ROOT, "supabase", "migrations");
  for (const file of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(dir, file), "utf8"));
  }
  for (const sql of extraSql) await db.exec(sql);
  return db;
}

// --------------------------------------------------------------------- jwt --

const b64 = (input) => Buffer.from(input).toString("base64url");

function sign(payload) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

function verify(token) {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const expected = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

// -------------------------------------------------------------------- app --

export async function startFakeSupabase({ port = 54321, host = "127.0.0.1", extraSql = [] } = {}) {
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("fake Supabase only binds to localhost");
  }

  let db = await createDatabase({ extraSql });
  let schema = await loadSchema(db);
  const passwords = new Map(); // email -> { id, password }
  const refreshTokens = new Map(); // token -> user id

  const userJson = async (id) => {
    const { rows } = await runExclusive(() => db.query("select id, email from auth.users where id = $1", [id]));
    if (!rows.length) return null;
    const email = rows[0].email;
    return {
      id,
      aud: "authenticated",
      role: "authenticated",
      email: email ?? "",
      phone: "",
      app_metadata: { provider: email ? "email" : "anonymous", providers: [email ? "email" : "anonymous"] },
      user_metadata: {},
      identities: [],
      is_anonymous: !email,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  const session = async (id) => {
    const now = Math.floor(Date.now() / 1000);
    const user = await userJson(id);
    const access = sign({
      aud: "authenticated", iss: "fake-supabase", iat: now, exp: now + 3600,
      sub: id, role: "authenticated", email: user.email, is_anonymous: user.is_anonymous,
      session_id: randomUUID(), aal: "aal1",
    });
    const refresh = randomBytes(12).toString("hex");
    refreshTokens.set(refresh, id);
    return { access_token: access, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user };
  };

  const claimsOf = (req) => {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const apikey = req.headers.apikey ?? "";
    if (bearer === SERVICE_KEY || apikey === SERVICE_KEY) return { role: "service_role", sub: null };
    const payload = bearer && bearer !== ANON_KEY ? verify(bearer) : null;
    if (payload) return { role: "authenticated", sub: payload.sub };
    return { role: "anon", sub: null };
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const cors = {
      "access-control-allow-origin": req.headers.origin ?? "*",
      "access-control-allow-headers": req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type, prefer, accept, x-client-info",
      "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
      "access-control-allow-credentials": "true",
    };
    const send = (status, json, extra = {}) => {
      res.writeHead(status, { ...cors, "content-type": "application/json", ...extra });
      res.end(json === null || json === undefined ? "" : JSON.stringify(json));
    };

    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : undefined;
      const path = url.pathname;

      // ---- test control ---------------------------------------------------
      if (path === "/__test/health") return send(200, { ok: true });
      if (path === "/__test/reset") {
        await runExclusive(async () => {
          await db.close();
          db = await createDatabase({ extraSql });
          schema = await loadSchema(db);
          passwords.clear();
          refreshTokens.clear();
        });
        return send(200, { ok: true });
      }
      if (path === "/__test/sql") {
        const result = await runExclusive(() => db.query(body.sql, body.params ?? []));
        // Structure may have changed (tests add tables/views).
        if (/\b(create|alter|drop)\b/i.test(body.sql)) schema = await runExclusive(() => loadSchema(db));
        return send(200, { rows: result.rows });
      }
      if (path === "/__test/create-user") {
        const { email, password, admin } = body;
        const { rows } = await runExclusive(() => db.query("insert into auth.users (email) values ($1) returning id", [email]));
        passwords.set(email, { id: rows[0].id, password });
        if (admin) await runExclusive(() => db.query("insert into public.admins (user_id, level) values ($1, $2)", [rows[0].id, admin]));
        return send(200, { id: rows[0].id });
      }

      // ---- auth -------------------------------------------------------------
      if (path === "/auth/v1/health") return send(200, { name: "GoTrue (fake)" });

      if (path === "/auth/v1/signup" && req.method === "POST") {
        if (body?.email) return send(400, { code: 400, error_code: "signup_disabled", msg: "Signups by email are disabled in the fake" });
        const { rows } = await runExclusive(() => db.query("insert into auth.users (email) values (null) returning id"));
        return send(200, await session(rows[0].id));
      }

      if (path === "/auth/v1/token" && req.method === "POST") {
        const grant = url.searchParams.get("grant_type");
        if (grant === "password") {
          const entry = passwords.get(body?.email);
          if (!entry || entry.password !== body?.password) {
            return send(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
          }
          return send(200, await session(entry.id));
        }
        if (grant === "refresh_token") {
          const id = refreshTokens.get(body?.refresh_token);
          if (!id) return send(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
          refreshTokens.delete(body.refresh_token);
          return send(200, await session(id));
        }
        return send(400, { msg: "unsupported grant_type" });
      }

      if (path === "/auth/v1/user" && req.method === "GET") {
        const payload = verify((req.headers.authorization ?? "").replace(/^Bearer\s+/i, ""));
        const user = payload ? await userJson(payload.sub) : null;
        return user ? send(200, user) : send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      }
      if (path === "/auth/v1/logout") return send(204, null);

      // ---- rest -------------------------------------------------------------
      if (path.startsWith("/rest/v1/")) {
        const rest = path.slice("/rest/v1/".length);
        const isRpc = rest.startsWith("rpc/");
        const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]));
        const { status, json } = await handleRest(db, schema, {
          method: req.method,
          table: isRpc ? null : rest,
          rpc: isRpc ? rest.slice(4) : null,
          searchParams: url.searchParams,
          headers,
          body,
          claims: claimsOf(req),
        });
        return send(status, json);
      }

      return send(404, { message: `fake supabase: no route for ${req.method} ${path}` });
    } catch (error) {
      if (error.status && error.body) return send(error.status, error.body);
      console.error("[fake-supabase] unexpected:", error);
      return send(500, { code: "XX000", message: String(error.message ?? error) });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  return {
    url: `http://${host}:${address.port}`,
    port: address.port,
    query: (sql, params) => runExclusive(() => db.query(sql, params)),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await db.close();
    },
  };
}

// CLI ------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const port = Number(process.env.FAKE_SUPABASE_PORT ?? 54321);
  const fake = await startFakeSupabase({ port });
  console.log(`[fake-supabase] listening on ${fake.url} (anon key: ${ANON_KEY})`);
}
