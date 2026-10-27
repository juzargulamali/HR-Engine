// LOCAL-ONLY stand-in for the parts of Supabase Auth (GoTrue) that the account controls use, so invitations, password resets, deactivation
// (ban), session cut-off and account deletion can be driven end to end against the throwaway database. It is NOT Supabase Auth: it is
// written from the documented behaviour of the endpoints the application calls, it never sends an e-mail (it records what would have been
// sent in local_auth.outbox so a test can open the link), and it holds no real credential. What it cannot show is how the hosted service
// itself behaves; docs/people-access-account-controls-verification.md says what that leaves for a hosted test project.
//
// Behaviour mirrored from GoTrue, because the application's design depends on it:
//   * a banned user cannot sign in or refresh a token (400 user_banned) and GET /user answers 403 user_banned, even with a valid access
//     token; the data API (PostgREST) does NOT know about bans, so an access token keeps working there until it expires
//   * a revoked or missing session answers 403 session_not_found on GET /user
//   * /admin/* needs the service-role key; anything else is 403 not_admin
//   * inviting or creating an address that already exists is 422 email_exists; /recover always answers 200 (no account enumeration)

const DDL = `
  create schema if not exists local_auth;
  create table if not exists local_auth.credentials (user_id uuid primary key, password text, banned_until timestamptz);
  create table if not exists local_auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, revoked boolean not null default false, created_at timestamptz not null default now());
  create table if not exists local_auth.outbox (id bigserial primary key, kind text not null, email text not null, action_link text not null, created_at timestamptz not null default now());
`;

export function createLocalAuth({ pool, sign, verify, fixedPassword, send, readBody }) {
  let ready; // created on first use, so printing the keys never needs the database
  const bearer = (req) => (req.headers.authorization ?? "").replace(/^Bearer /i, "");
  const fail = (res, code, errorCode, msg) => send(res, code, { code, error_code: errorCode, msg });
  const banned = (row) => Boolean(row?.banned_until && new Date(row.banned_until) > new Date());

  const toUser = (row) => ({
    id: row.id, aud: "authenticated", role: "authenticated", email: row.email, email_confirmed_at: row.created_at, phone: "",
    app_metadata: { provider: "email", providers: ["email"] }, user_metadata: row.raw_user_meta_data ?? {}, identities: [],
    created_at: row.created_at, updated_at: row.created_at, is_anonymous: false, banned_until: row.banned_until ?? null,
  });
  const loadUser = async (where, value) =>
    (await pool.query(
      `select u.id, u.email, u.raw_user_meta_data, u.created_at, c.banned_until from auth.users u left join local_auth.credentials c on c.user_id = u.id where ${where}`,
      [value],
    )).rows[0];

  async function startSession(row) {
    const sessionId = (await pool.query("insert into local_auth.sessions (user_id) values ($1) returning id", [row.id])).rows[0].id;
    const now = Math.floor(Date.now() / 1000);
    const claims = { aud: "authenticated", role: "authenticated", sub: row.id, email: row.email, iat: now, exp: now + 3600, session_id: sessionId, app_metadata: { provider: "email" }, user_metadata: {}, is_anonymous: false };
    return {
      access_token: sign(claims), token_type: "bearer", expires_in: 3600, expires_at: claims.exp,
      refresh_token: sign({ sub: row.id, sid: sessionId, kind: "refresh", exp: now + 86400 }), user: toUser(row),
    };
  }
  const hashLink = (redirectTo, s, type) =>
    `${redirectTo}#access_token=${s.access_token}&expires_in=${s.expires_in}&refresh_token=${s.refresh_token}&token_type=bearer&type=${type}`;

  // The user behind a bearer token, or an HTTP answer already sent.
  async function authenticate(req, res) {
    const claims = verify(bearer(req));
    if (!claims?.sub) { fail(res, 401, "bad_jwt", "invalid JWT"); return null; }
    const row = await loadUser("u.id = $1", claims.sub);
    if (!row) { fail(res, 403, "user_not_found", "User from sub claim in JWT does not exist"); return null; }
    if (banned(row)) { fail(res, 403, "user_banned", "User is banned"); return null; }
    const session = claims.session_id ? (await pool.query("select revoked from local_auth.sessions where id = $1 and user_id = $2", [claims.session_id, row.id])).rows[0] : null;
    if (claims.session_id && (!session || session.revoked)) { fail(res, 403, "session_not_found", "Session from session_id claim in JWT does not exist"); return null; }
    return { claims, row };
  }
  const isServiceRole = (req) => verify(req.headers.apikey ?? "")?.role === "service_role" || verify(bearer(req))?.role === "service_role";

  return async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/auth/v1/")) return false;
    await (ready ??= pool.query(DDL));
    const json = async () => JSON.parse((await readBody(req)).toString() || "{}");

    if (p === "/auth/v1/token" && req.method === "POST") {
      const body = await json();
      const grant = url.searchParams.get("grant_type");
      if (grant === "password") {
        const row = await loadUser("lower(u.email) = lower($1)", body.email ?? "");
        const stored = row ? (await pool.query("select password from local_auth.credentials where user_id = $1", [row.id])).rows[0]?.password : null;
        if (!row || body.password !== (stored ?? fixedPassword)) return fail(res, 400, "invalid_credentials", "Invalid login credentials"), true;
        if (banned(row)) return fail(res, 400, "user_banned", "User is banned"), true;
        return send(res, 200, await startSession(row)), true;
      }
      if (grant === "refresh_token") {
        const claims = verify(body.refresh_token);
        if (!claims || claims.kind !== "refresh") return fail(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found"), true;
        const row = await loadUser("u.id = $1", claims.sub);
        if (!row) return fail(res, 400, "user_not_found", "user not found"), true;
        if (banned(row)) return fail(res, 400, "user_banned", "User is banned"), true;
        const session = (await pool.query("select revoked from local_auth.sessions where id = $1", [claims.sid])).rows[0];
        if (!session || session.revoked) return fail(res, 400, "session_not_found", "Invalid Refresh Token: Session Not Found"), true;
        const now = Math.floor(Date.now() / 1000);
        const access = { aud: "authenticated", role: "authenticated", sub: row.id, email: row.email, iat: now, exp: now + 3600, session_id: claims.sid, app_metadata: { provider: "email" }, user_metadata: {}, is_anonymous: false };
        return send(res, 200, { access_token: sign(access), token_type: "bearer", expires_in: 3600, expires_at: access.exp, refresh_token: sign({ sub: row.id, sid: claims.sid, kind: "refresh", exp: now + 86400 }), user: toUser(row) }), true;
      }
      return fail(res, 400, "unsupported_grant_type", "unsupported grant"), true;
    }

    if (p === "/auth/v1/user" && req.method === "GET") {
      const auth = await authenticate(req, res);
      if (auth) send(res, 200, toUser(auth.row));
      return true;
    }
    if (p === "/auth/v1/user" && req.method === "PUT") {
      const auth = await authenticate(req, res);
      if (!auth) return true;
      const body = await json();
      if (typeof body.password === "string") {
        await pool.query("insert into local_auth.credentials (user_id, password) values ($1, $2) on conflict (user_id) do update set password = excluded.password", [auth.row.id, body.password]);
      }
      if (body.data) await pool.query("update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb where id = $1", [auth.row.id, JSON.stringify(body.data)]);
      send(res, 200, toUser(await loadUser("u.id = $1", auth.row.id)));
      return true;
    }
    if (p === "/auth/v1/logout" && req.method === "POST") {
      const claims = verify(bearer(req));
      if (!claims?.sub) return send(res, 204), true;
      const scope = url.searchParams.get("scope") ?? "global";
      if (scope === "local") await pool.query("update local_auth.sessions set revoked = true where id = $1", [claims.session_id]);
      else if (scope === "others") await pool.query("update local_auth.sessions set revoked = true where user_id = $1 and id <> $2", [claims.sub, claims.session_id]);
      else await pool.query("update local_auth.sessions set revoked = true where user_id = $1", [claims.sub]);
      return send(res, 204), true;
    }

    if (p === "/auth/v1/invite" && req.method === "POST") {
      if (!isServiceRole(req)) return fail(res, 403, "not_admin", "User not allowed"), true;
      const body = await json();
      if (await loadUser("lower(u.email) = lower($1)", body.email ?? "")) return fail(res, 422, "email_exists", "A user with this email address has already been registered"), true;
      const id = (await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id", [body.email, JSON.stringify(body.data ?? {})])).rows[0].id;
      const row = await loadUser("u.id = $1", id);
      const redirect = url.searchParams.get("redirect_to") ?? "http://127.0.0.1:3000";
      await pool.query("insert into local_auth.outbox (kind, email, action_link) values ('invite', $1, $2)", [body.email, hashLink(redirect, await startSession(row), "invite")]);
      return send(res, 200, toUser(row)), true;
    }
    if (p === "/auth/v1/recover" && req.method === "POST") {
      const body = await json();
      const row = await loadUser("lower(u.email) = lower($1)", body.email ?? "");
      if (row) {
        const redirect = url.searchParams.get("redirect_to") ?? "http://127.0.0.1:3000";
        await pool.query("insert into local_auth.outbox (kind, email, action_link) values ('recovery', $1, $2)", [row.email, hashLink(redirect, await startSession(row), "recovery")]);
      }
      return send(res, 200, {}), true;
    }

    const admin = p.match(/^\/auth\/v1\/admin\/users(?:\/([0-9a-f-]{36}))?$/);
    if (admin) {
      if (!isServiceRole(req)) return fail(res, 403, "not_admin", "User not allowed"), true;
      const id = admin[1];
      if (!id && req.method === "POST") {
        const body = await json();
        if (await loadUser("lower(u.email) = lower($1)", body.email ?? "")) return fail(res, 422, "email_exists", "A user with this email address has already been registered"), true;
        const created = (await pool.query("insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id", [body.email, JSON.stringify(body.user_metadata ?? {})])).rows[0].id;
        if (typeof body.password === "string") await pool.query("insert into local_auth.credentials (user_id, password) values ($1, $2)", [created, body.password]);
        return send(res, 200, toUser(await loadUser("u.id = $1", created))), true;
      }
      if (id) {
        const row = await loadUser("u.id = $1", id);
        if (!row) return fail(res, 404, "user_not_found", "User not found"), true;
        if (req.method === "GET") return send(res, 200, toUser(row)), true;
        if (req.method === "PUT") {
          const body = await json();
          if (typeof body.ban_duration === "string") {
            const hours = body.ban_duration === "none" ? null : /^(\d+)h$/.exec(body.ban_duration)?.[1];
            if (body.ban_duration !== "none" && !hours) return fail(res, 400, "validation_failed", "invalid ban_duration"), true;
            await pool.query("insert into local_auth.credentials (user_id, banned_until) values ($1, case when $2::int is null then null else now() + ($2::int * interval '1 hour') end) on conflict (user_id) do update set banned_until = excluded.banned_until", [id, hours ? Number(hours) : null]);
          }
          if (typeof body.password === "string") await pool.query("insert into local_auth.credentials (user_id, password) values ($1, $2) on conflict (user_id) do update set password = excluded.password", [id, body.password]);
          return send(res, 200, toUser(await loadUser("u.id = $1", id))), true;
        }
        if (req.method === "DELETE") {
          await pool.query("delete from local_auth.sessions where user_id = $1", [id]);
          await pool.query("delete from local_auth.credentials where user_id = $1", [id]);
          await pool.query("delete from auth.users where id = $1", [id]);
          return send(res, 200, {}), true;
        }
      }
    }
    return false;
  };
}
