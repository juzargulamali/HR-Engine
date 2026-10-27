// LOCAL-ONLY stand-in for the two Supabase services the app talks to, so the REAL Next.js app can be driven by a REAL
// browser against a REAL Postgres without any hosted project:
//   /rest/v1/*  -> PostgREST (the same component Supabase uses), enforcing the real RLS policies
//   /auth/v1/*  -> a minimal token service (sign-in, refresh, user, logout, plus the invite / recover / admin endpoints the account
//                  controls use: see local-auth.mjs) that signs HS256 JWTs with the same secret PostgREST verifies. A user without a
//                  password of their own accepts one fixed local password. It is NOT Supabase Auth and never touches a real account.
// Usage: node gateway.mjs   (env: GATEWAY_PORT=54321 POSTGREST_PORT=3001 LOCAL_DB_URL=... LOCAL_JWT_SECRET=...)
import http from "node:http";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Pool } = require("pg");
import { createLocalAuth } from "./local-auth.mjs";

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
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });

const localAuth = createLocalAuth({ pool, sign, verify, fixedPassword: PASSWORD, send, readBody });

// Print the anon/service keys the app needs and exit: node gateway.mjs --keys
if (process.argv.includes("--keys")) {
  const now = Math.floor(Date.now() / 1000);
  console.log(JSON.stringify({ anon: sign({ role: "anon", iss: "local", iat: now, exp: now + 86400 * 30 }), service: sign({ role: "service_role", iss: "local", iat: now, exp: now + 86400 * 30 }) }));
  process.exit(0);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  // Hosted Supabase answers browser calls from the app's origin (the set-password page signs in from the browser): so does this stand-in.
  res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
  res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "authorization, apikey, content-type");
  res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  try {
    if (url.pathname.startsWith("/rest/v1/")) {
      const upstream = http.request({ host: "127.0.0.1", port: PGRST, method: req.method, path: url.pathname.replace("/rest/v1", "") + url.search, headers: { ...req.headers, host: `127.0.0.1:${PGRST}` } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
      upstream.on("error", () => send(res, 502, { message: "PostgREST not reachable" }));
      req.pipe(upstream);
      return;
    }
    if (await localAuth(req, res, url)) return;
    send(res, 404, { msg: `local stack: ${req.method} ${url.pathname} is not implemented` });
  } catch (e) {
    send(res, 500, { msg: String(e?.message ?? e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`local gateway on :${PORT}`));

