// LOCAL-ONLY stand-in for the two Supabase services the app talks to, so the REAL Next.js app can be driven by a REAL
// browser against a REAL Postgres without any hosted project:
//   /rest/v1/*  -> PostgREST (the same component Supabase uses), enforcing the real RLS policies
//   /auth/v1/*  -> a minimal password-grant token service (sign-in, refresh, user, logout) that signs HS256 JWTs with the
//                  same secret PostgREST verifies. It accepts one fixed local password for users that exist in the throwaway
//                  database's auth.users table. It is NOT Supabase Auth and never touches a real account or credential.
// Usage: node gateway.mjs   (env: GATEWAY_PORT=54321 POSTGREST_PORT=3001 LOCAL_DB_URL=... LOCAL_JWT_SECRET=...)
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");

const PORT = Number(process.env.GATEWAY_PORT ?? 54321);
const PGRST = Number(process.env.POSTGREST_PORT ?? 3001);
const SECRET = process.env.LOCAL_JWT_SECRET ?? "local-stack-only-secret-0123456789abcdef";
const PASSWORD = process.env.LOCAL_STACK_PASSWORD ?? "local-stack-password";
const pool = new Pool({ connectionString: process.env.LOCAL_DB_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/hr_local_stack" });

const b64 = (b) => Buffer.from(b).toString("base64url");
function sign(payload) {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [h, p, s] = String(token).split(".");
  if (!h || !p || !s) return null;
  const expect = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (expect.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp && claims.exp * 1000 < Date.now() ? null : claims;
}
const user = (row) => ({
  id: row.id, aud: "authenticated", role: "authenticated", email: row.email, email_confirmed_at: row.created_at,
  phone: "", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: row.raw_user_meta_data ?? {},
  identities: [], created_at: row.created_at, updated_at: row.created_at, is_anonymous: false,
});
function session(row) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: "authenticated", role: "authenticated", sub: row.id, email: row.email, iat: now, exp: now + 3600, session_id: row.id, app_metadata: { provider: "email" }, user_metadata: {}, is_anonymous: false };
  return { access_token: sign(claims), token_type: "bearer", expires_in: 3600, expires_at: claims.exp, refresh_token: sign({ sub: row.id, kind: "refresh", exp: now + 86400 }), user: user(row) };
}
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });

// Print the anon/service keys the app needs and exit: node gateway.mjs --keys
if (process.argv.includes("--keys")) {
  const now = Math.floor(Date.now() / 1000);
  console.log(JSON.stringify({ anon: sign({ role: "anon", iss: "local", iat: now, exp: now + 86400 * 30 }), service: sign({ role: "service_role", iss: "local", iat: now, exp: now + 86400 * 30 }) }));
  process.exit(0);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname.startsWith("/rest/v1/")) {
      const upstream = http.request({ host: "127.0.0.1", port: PGRST, method: req.method, path: url.pathname.replace("/rest/v1", "") + url.search, headers: { ...req.headers, host: `127.0.0.1:${PGRST}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      upstream.on("error", () => send(res, 502, { message: "PostgREST not reachable" }));
      req.pipe(upstream);
      return;
    }
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const grant = url.searchParams.get("grant_type");
      let row;
      if (grant === "password") {
        if (body.password !== PASSWORD) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        row = (await pool.query("select id, email, raw_user_meta_data, created_at from auth.users where lower(email) = lower($1)", [body.email])).rows[0];
        if (!row) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      } else if (grant === "refresh_token") {
        const claims = verify(body.refresh_token);
        if (!claims) return send(res, 400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
        row = (await pool.query("select id, email, raw_user_meta_data, created_at from auth.users where id = $1", [claims.sub])).rows[0];
        if (!row) return send(res, 400, { code: 400, msg: "user not found" });
      } else return send(res, 400, { msg: "unsupported grant" });
      return send(res, 200, session(row));
    }
    if (url.pathname === "/auth/v1/user" && req.method === "GET") {
      const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /i, ""));
      if (!claims?.sub) return send(res, 401, { code: 401, msg: "invalid JWT" });
      const row = (await pool.query("select id, email, raw_user_meta_data, created_at from auth.users where id = $1", [claims.sub])).rows[0];
      return row ? send(res, 200, user(row)) : send(res, 401, { code: 401, msg: "user not found" });
    }
    if (url.pathname === "/auth/v1/logout") return send(res, 204);
    send(res, 404, { msg: `local stack: ${req.method} ${url.pathname} is not implemented` });
  } catch (e) {
    send(res, 500, { msg: String(e?.message ?? e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`local gateway on :${PORT}`));

