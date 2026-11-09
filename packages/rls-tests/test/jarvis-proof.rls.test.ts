import { readFileSync } from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";
import { callArgs, deriveProofKey, deriveReviewKey, PROOF_KEY, proofCall, proofText, reviewCall, sha256Hex, wrapperSql, type ProofCall } from "../src/jarvis-proof";

// THE CONFIRMATION BOUNDARY, proved against a real Postgres (migration 20261223000100_jarvis_platform.sql). Fictional data only.
//
// The defects this closes: (1) the confirmation token used to be checked only in the app server, so an eligible pilot person could call a JARVIS wrapper straight through the API with a
// confirmation id and hash they made up; (2) after that fix the proposal step still returned to the browser the very MAC the database accepts as proof, so a pilot person could take the
// proposal's token and call a wrapper without the explicit confirmation ever happening; (3) the register-organisation duplicate acknowledgement was outside the signed material.
// Now there are TWO artefacts: the browser holds a REVIEW TOKEN (review key, domain JARVIS-REVIEW-V1: no wrapper accepts it), and the DATABASE PROOF (proof key derived from the same
// secret, domain JARVIS-PROOF-V1) exists only inside the server's confirmation request. EVERY write wrapper verifies the proof inside the database; the register wrapper reads its
// acknowledgement only from the verified payload and checks it against what exists. Every test below calls the wrapper DIRECTLY as an eligible pilot person (pilot on, Sales grant,
// correct company), the way an attacker with a session token would, and checks that nothing is written when the proof is not a genuine, current proof of exactly this call.
const MIGRATION = "20261223000100_jarvis_platform.sql";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { sara: id(), omar: id(), founder: id(), noGrant: id(), ksaStaff: id(), outsider: id() };
const CREATE = "jarvis.sales.enquiry.create_from_brief";
const REGISTER = "jarvis.sales.organisation.register";
const UPDATE = "jarvis.sales.enquiry.update";
const STAGE = "jarvis.sales.enquiry.change_stage";
const MEETING = "jarvis.sales.meeting.record";
const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();
const VECTORS = JSON.parse(readFileSync(path.resolve(__dirname, "../../../supabase/tests/jarvis-proof-vectors.json"), "utf8")) as {
  secret: string;
  proofKey: string;
  reviewKey: string;
  derivation: { label: string; key: string }[];
  reviews: { name: string; jti: string; uid: string; co: string; exp: number; act: string; tgt: string; ver: number | null; payloadSha256: string; canonical: string; mac: string }[];
  proofs: { name: string; jti: string; uid: string; co: string; exp: number; act: string; tgt: string; ver: number | null; payload: string; payloadSha256: string; canonical: string; mac: string }[];
  hmac: { key: string; message: string; mac: string }[];
};

describe("JARVIS confirmation boundary: server-issued proof verified inside the database", () => {
  const db = new RlsTestDatabase();
  type Rows<T> = [T, ...T[]];
  const commit = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as Rows<T>);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as Rows<T>;
  const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error("expected a refusal, but the call succeeded"); };
  const j = (o: unknown) => JSON.stringify(o);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");

  let clientId = ""; let agencyId = ""; let plainOrg = "";
  const world = async () => (await admin<Record<string, string>>(`select
      (select count(*)::text from crm_opportunities) as opps, (select count(*)::text from crm_organisations) as orgs, (select count(*)::text from crm_follow_ups) as follow_ups,
      (select count(*)::text from crm_activities) as activities, (select count(*)::text from crm_opportunity_events) as events, (select count(*)::text from jarvis_action_ledger) as ledger,
      (select count(*)::text from jarvis_action_ledger where status = 'done') as confirmed, (select coalesce(sum(last_value), 0)::text from crm_reference_counters) as counters,
      (select md5(string_agg(o::text, ',' order by id)) from crm_opportunities o) as opp_rows`))[0];
  const newEnquiry = async (user = U.sara, title = "Fictional harbour gala") =>
    (await commit<{ id: string }>(user, `select crm_create_opportunity(p_company_id => $1::uuid, p_title => $2, p_source => 'whatsapp', p_next_title => 'Call', p_next_due => $3::timestamptz, p_client_org_id => $4::uuid, p_location => 'Harbour Hall', p_technologies => '[{"name":"LED wall","qty":2}]'::jsonb) as id`, [CO.uae, title, SOON, clientId]))[0].id;
  const versionOf = async (oid: string) => Number((await admin<{ version: number }>(`select version from crm_opportunities where id = '${oid}'`))[0].version);

  /** One entry per write wrapper: how to build a VALID call for it and a different (also signed) payload for the "values changed" cases. */
  interface Kind {
    name: string; fn: string; action: string; versioned: boolean;
    /** A fresh, valid call as `user` would be approved by the server. */
    make(user: string, o?: { jti?: string; expires?: number; key?: string }): Promise<{ call: ProofCall; params: unknown[]; target: string }>;
    /** The same call, signed for a DIFFERENT payload (not the one that is sent). */
    altPayload(call: ProofCall): string;
  }
  const orgPayload = (over: Record<string, unknown> = {}) => ({ acknowledged_org_ids: [], company_id: CO.uae, name: `Fictional Org ${randomBytes(4).toString("hex")}`, roles: ["agency"], country_code: "AE", website: null, place: "Dubai", note: null, ...over });
  const createPayload = (over: Record<string, unknown> = {}) => ({
    company_id: CO.uae, title: `Fictional LED wall ${randomBytes(3).toString("hex")}`, source: "whatsapp", next_title: "Call to qualify the brief", next_due: SOON, next_kind: "call",
    agency_org_id: agencyId, client_org_id: clientId, currency: "AED", value: 45000, brief: "SECRET-BRIEF-TEXT-1234", location: "Harbour Hall", technologies: [{ name: "LED wall", qty: 2 }], ...over,
  });
  const KINDS: Kind[] = [
    {
      name: "create an enquiry", fn: "jarvis_create_enquiry", action: CREATE, versioned: false,
      make: async (user, o = {}) => { const call = proofCall({ user, company: CO.uae, action: CREATE, target: "new", payload: createPayload(), ...o }); return { call, params: callArgs(call), target: "new" }; },
      altPayload: (c) => j({ ...JSON.parse(c.payload), title: "A different title nobody reviewed" }),
    },
    {
      name: "register an organisation", fn: "jarvis_register_organisation", action: REGISTER, versioned: false,
      make: async (user, o = {}) => { const call = proofCall({ user, company: CO.uae, action: REGISTER, target: "new", payload: orgPayload(), ...o }); return { call, params: callArgs(call), target: "new" }; },
      altPayload: (c) => j({ ...JSON.parse(c.payload), name: "A Different Organisation Nobody Reviewed" }),
    },
    {
      name: "update an enquiry", fn: "jarvis_update_enquiry", action: UPDATE, versioned: true,
      make: async (user, o = {}) => { const oid = await newEnquiry(); const call = proofCall({ user, company: CO.uae, action: UPDATE, target: oid, version: await versionOf(oid), payload: { location: "Marina Arena", scope: "Supply and operate" }, ...o }); return { call, params: callArgs(call), target: oid }; },
      altPayload: (c) => j({ ...JSON.parse(c.payload), location: "Somewhere nobody reviewed" }),
    },
    {
      name: "change an enquiry's stage", fn: "jarvis_change_stage", action: STAGE, versioned: true,
      make: async (user, o = {}) => { const oid = await newEnquiry(); const call = proofCall({ user, company: CO.uae, action: STAGE, target: oid, version: await versionOf(oid), payload: { to: "qualified" }, ...o }); return { call, params: callArgs(call), target: oid }; },
      altPayload: () => j({ to: "negotiation" }),
    },
    {
      name: "record a meeting", fn: "jarvis_record_meeting", action: MEETING, versioned: false,
      make: async (user, o = {}) => {
        const oid = await newEnquiry();
        const payload = { activity: { kind: "meeting", body: "SECRET-MEETING-NOTES-4242 agreed two LED walls", occurred_at: null, internal: false }, follow_up: { title: "Send the proposal", due_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), kind: "proposal" } };
        const call = proofCall({ user, company: CO.uae, action: MEETING, target: oid, payload, ...o });
        return { call, params: callArgs(call), target: oid };
      },
      altPayload: (c) => j({ ...JSON.parse(c.payload), activity: { ...JSON.parse(c.payload).activity, body: "Notes nobody reviewed" } }),
    },
  ];
  const send = (kind: Kind, user: string, params: unknown[]) => commit<{ r: Record<string, unknown> }>(user, wrapperSql(kind.fn), params);
  const POS = { jti: 0, company: 1, target: 2, version: 3, expires: 4, mac: 5, payload: 6 } as const;
  const sameWorld = async (before: Record<string, string>) => expect(await world()).toEqual(before);

  beforeAll(async () => {
    await db.setupBefore(MIGRATION);
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA LLC', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@jarvis-proof-test.ae')`).join(", ")};
      insert into auth.users (id, email) values ('${VECTORS.proofs[0]!.uid}', 'vector-user@jarvis-proof-test.ae');
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR');
    `);
    await db.seed(`
      grant select, insert, update, delete on all tables in schema public to authenticated;
      insert into crm_company_grants (user_id, company_id, capabilities) values
        ('${U.founder}', '${CO.uae}', '{founder}'), ('${U.sara}', '${CO.uae}', '{}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaStaff}', '${CO.ksa}', '{}');
    `);
    await db.applyMigration(MIGRATION);
    // ELIGIBLE pilot people: switches on, on the allowlist, active, with a Sales grant for the company. The proof key is deliberately NOT set yet.
    await admin(`update jarvis_settings set enabled = true, writes_enabled = true`);
    await admin(`insert into jarvis_pilot_users (user_id) values ('${U.sara}'), ('${U.omar}'), ('${U.founder}'), ('${U.noGrant}'), ('${U.ksaStaff}')`);
    clientId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Harbour Client', p_roles => '{client}', p_country_code => 'AE') as id`))[0].id;
    agencyId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Wave Agency', p_roles => '{agency}', p_country_code => 'AE') as id`))[0].id;
    plainOrg = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Tech Only Co', p_roles => '{technology}', p_country_code => 'AE') as id`))[0].id;
  });
  afterAll(async () => { await db.teardown(); });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("the proof key: not set = fail closed; never readable; set only by the owner", () => {
    it("with NO key set every wrapper fails closed (JV004) even for a perfectly signed call by an eligible person, and writes nothing", async () => {
      expect((await admin(`select 1 from jarvis_proof_key`)).length).toBe(0);
      const info = ((await db.seed(pack("jarvis_20_verify_readonly.sql"))).rows as { item: string; result: string }[]).find((r) => r.item.includes("confirmation proof key"));
      expect(info?.result).toBe("not set");
      const calls = await Promise.all(KINDS.map(async (k) => ({ k, ...(await k.make(U.sara)) }))); // (building a call may create its fictional enquiry: snapshot AFTER)
      const before = await world();
      for (const { k, params } of calls) expect((await rejection(send(k, U.sara, params))).code, k.name).toBe("JV004");
      await sameWorld(before);
    });
    it("a signed-in person cannot set, rotate or clear the key: not through the setter, not through the table", async () => {
      for (const sql of [`select jarvis_set_proof_key('${"x".repeat(40)}')`, `insert into jarvis_proof_key (secret) values ('${"x".repeat(40)}')`, `update jarvis_proof_key set secret = '${"x".repeat(40)}'`, `delete from jarvis_proof_key`, `truncate jarvis_proof_key`]) {
        expect((await rejection(commit(U.sara, sql))).message, sql).toMatch(/permission denied|row-level security/);
      }
      for (const sql of [`select jarvis_set_proof_key('${"x".repeat(40)}')`, `select * from jarvis_proof_key`]) expect((await rejection(commit(null, sql))).message).toMatch(/permission denied/);
      expect((await admin(`select 1 from jarvis_proof_key`)).length).toBe(0);
    });
    it("the owner sets the key (at least 32 characters) with the one-line step; a short key is refused", async () => {
      expect((await rejection(admin(`select jarvis_set_proof_key('too short')`))).code).toBe("22023");
      expect((await rejection(admin(`select jarvis_set_proof_key(null)`))).code).toBe("22023");
      await admin(`select jarvis_set_proof_key('${PROOF_KEY}')`);
      expect((await admin(`select count(*)::int n from jarvis_proof_key`))[0]).toEqual({ n: 1 });
      // the database stores ONLY the derived proof key (hex), never the root secret, and never the review key
      const stored = (await admin<{ secret: string }>(`select secret from jarvis_proof_key`))[0].secret;
      expect(stored).toBe(deriveProofKey(PROOF_KEY).toString("hex"));
      expect(stored).not.toBe(PROOF_KEY);
      expect(stored).not.toBe(deriveReviewKey(PROOF_KEY).toString("hex"));
      const info = ((await db.seed(pack("jarvis_20_verify_readonly.sql"))).rows as { item: string; result: string }[]).find((r) => r.item.includes("confirmation proof key"));
      expect(info?.result).toMatch(/^set \(since /);
      expect(JSON.stringify(info)).not.toContain(PROOF_KEY);
      expect(JSON.stringify(info)).not.toContain(deriveProofKey(PROOF_KEY).toString("hex"));
    });
    it("the key cannot be read by signed-in people or anon: not the table, not the proof functions, not jarvis_my_access, not any pack output", async () => {
      for (const u of [U.sara, U.founder, U.outsider, null]) {
        expect((await rejection(commit(u, `select * from jarvis_proof_key`))).message).toMatch(/permission denied/);
        expect((await rejection(commit(u, `select secret from jarvis_proof_key`))).message).toMatch(/permission denied/);
        for (const sql of [`select jarvis_hmac_sha256('k'::bytea, 'm'::bytea)`, `select jarvis_verify_proof('${CREATE}', '${id()}', '${CO.uae}', 'new', null, 5, '${"a".repeat(64)}', '{}')`]) {
          expect((await rejection(commit(u, sql))).message, `${u} ${sql}`).toMatch(/permission denied/);
        }
      }
      const access = (await commit<Record<string, unknown>>(U.sara, `select * from jarvis_my_access()`))[0];
      expect(Object.keys(access).sort()).toEqual(["company_allowed", "is_available", "writes_allowed"]);
      expect(JSON.stringify(access)).not.toContain(PROOF_KEY);
      // the key appears in no ledger row, no wrapper result, no pack result
      const dump = JSON.stringify([await admin(`select * from jarvis_action_ledger`), await admin(`select * from jarvis_my_access()`)]);
      for (const secret of [PROOF_KEY, deriveProofKey(PROOF_KEY).toString("hex"), deriveReviewKey(PROOF_KEY).toString("hex")]) {
        expect(dump).not.toContain(secret);
        for (const f of ["jarvis_00_preflight_readonly.sql", "jarvis_05_preservation_check_readonly.sql", "jarvis_20_verify_readonly.sql"]) expect(JSON.stringify((await db.seed(pack(f))).rows)).not.toContain(secret);
      }
      // the review key is not in the database at all: no function text and no table row mentions it
      expect((await admin<{ n: string }>(`select count(*)::text n from pg_proc where proname like 'jarvis\\_%' and prosrc like '%JARVIS-REVIEW%'`))[0].n).toBe("0");
      expect((await admin<{ n: string }>(`select count(*)::text n from jarvis_proof_key where secret = '${deriveReviewKey(PROOF_KEY).toString("hex")}'`))[0].n).toBe("0");
    });
    it("the platform service role cannot read or call the key machinery either", async () => {
      const rows = await admin<{ a: boolean; b: boolean; c: boolean; d: boolean }>(`select has_table_privilege('service_role', 'public.jarvis_proof_key', 'select') a,
        has_function_privilege('service_role', 'public.jarvis_set_proof_key(text)', 'execute') b, has_function_privilege('service_role', 'public.jarvis_verify_proof(text, uuid, uuid, text, integer, bigint, text, text)', 'execute') c,
        has_function_privilege('service_role', 'public.jarvis_hmac_sha256(bytea, bytea)', 'execute') d`);
      expect(rows[0]).toEqual({ a: false, b: false, c: false, d: false });
    });
    it("the verify pack passes completely with the key set (every pass/fail row says OK)", async () => {
      const rows = (await db.seed(pack("jarvis_20_verify_readonly.sql"))).rows as { item: string; result: string }[];
      expect(rows.filter((r) => !r.item.startsWith("INFORMATION") && r.result !== "OK")).toEqual([]);
      expect(rows.filter((r) => r.item.startsWith("THE CONFIRMATION BOUNDARY")).length).toBe(5);
      expect(rows.filter((r) => r.item.startsWith("NO UNSIGNED WRITE PARAMETERS")).length).toBe(5);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("shared MAC vectors: the TypeScript signer and the SQL verifier agree", () => {
    it("jarvis_hmac_sha256 equals Node's HMAC-SHA256 on every vector (short and over-long keys, empty and long messages, non-ASCII text)", async () => {
      for (const v of VECTORS.hmac) {
        const r = await admin<{ mac: string }>(`select encode(jarvis_hmac_sha256(convert_to($$${v.key}$$, 'UTF8'), convert_to($$${v.message}$$, 'UTF8')), 'hex') as mac`);
        expect(r[0].mac, `${v.key.length}/${v.message.length}`).toBe(v.mac);
      }
    });
    it("both key derivations agree: SQL (jarvis_set_proof_key stores HMAC(secret, 'JARVIS-PROOF-KEY-V1') as hex) = Node = the vectors; the review key is a different value the database never computes", async () => {
      expect(deriveProofKey(VECTORS.secret).toString("hex")).toBe(VECTORS.proofKey);
      expect(deriveReviewKey(VECTORS.secret).toString("hex")).toBe(VECTORS.reviewKey);
      expect(VECTORS.proofKey).not.toBe(VECTORS.reviewKey);
      for (const d of VECTORS.derivation) {
        const r = await admin<{ k: string }>(`select encode(jarvis_hmac_sha256(convert_to($$${VECTORS.secret}$$, 'UTF8'), convert_to('${d.label}', 'UTF8')), 'hex') as k`);
        expect(r[0].k, d.label).toBe(d.key);
      }
      const original = (await admin<{ secret: string }>(`select secret from jarvis_proof_key`))[0].secret;
      await admin(`select jarvis_set_proof_key('${VECTORS.secret}')`);
      try {
        expect((await admin<{ secret: string }>(`select secret from jarvis_proof_key`))[0].secret).toBe(VECTORS.proofKey);
      } finally {
        await admin(`update jarvis_proof_key set secret = '${original}'`);
      }
    });
    it("the test-side signers reproduce the vector MACs: the proof MAC (proof key, JARVIS-PROOF-V1) and the review MAC (review key, JARVIS-REVIEW-V1), and the two always differ", () => {
      for (const p of VECTORS.proofs) {
        expect(sha256Hex(p.payload)).toBe(p.payloadSha256);
        const c = proofCall({ user: p.uid, company: p.co, action: p.act, target: p.tgt, version: p.ver, payload: p.payload, jti: p.jti, expires: p.exp, key: VECTORS.secret });
        expect(c.mac, p.name).toBe(p.mac);
        expect(proofText({ jti: p.jti, user: p.uid, company: p.co, action: p.act, target: p.tgt, version: p.ver, expires: p.exp, payload: p.payload })).toBe(p.canonical);
      }
      for (const [i, r] of VECTORS.reviews.entries()) {
        const p = VECTORS.proofs[i]!;
        const c = reviewCall({ user: r.uid, company: r.co, action: r.act, target: r.tgt, version: r.ver, payload: p.payload, jti: r.jti, expires: r.exp, key: VECTORS.secret });
        expect(c.mac, r.name).toBe(r.mac);
        expect(r.mac).not.toBe(p.mac);
        expect(r.canonical.split("\n")[0]).toBe("JARVIS-REVIEW-V1");
      }
    });
    it("jarvis_verify_proof accepts EXACTLY the vector proofs (same canonical text, same MAC) and returns the payload hash; any one-character change is refused; the vector REVIEW MACs are refused as proofs", async () => {
      const original = (await admin<{ secret: string }>(`select secret from jarvis_proof_key`))[0].secret;
      await admin(`select jarvis_set_proof_key('${VECTORS.secret}')`);
      try {
        const verify = async (uid: string, p: { jti: string; co: string; act: string; tgt: string; ver: number | null; exp: number; mac: string; payload: string }) => {
          const claims = JSON.stringify({ sub: uid, role: "authenticated" }).replace(/'/g, "''");
          try {
            const r = (await db.seed(`select set_config('request.jwt.claims', '${claims}', false); select jarvis_verify_proof('${p.act}', '${p.jti}', '${p.co}', '${p.tgt}', ${p.ver === null ? "null" : p.ver}, ${p.exp}, '${p.mac}', $$${p.payload}$$) as h;`)) as unknown as { rows: { h: string }[] }[];
            return r[1]!.rows[0]!.h;
          } catch (e) { return (e as { code?: string }).code ?? "error"; } finally { await db.seed(`select set_config('request.jwt.claims', '', false)`); }
        };
        for (const [i, p] of VECTORS.proofs.entries()) {
          expect(await verify(p.uid, p), p.name).toBe(p.payloadSha256);
          const flipped = `${p.mac.slice(0, -1)}${p.mac.endsWith("0") ? "1" : "0"}`;
          expect(await verify(p.uid, { ...p, mac: flipped }), `${p.name} (mac)`).toBe("JV002");
          expect(await verify(p.uid, { ...p, payload: `${p.payload} ` }), `${p.name} (payload)`).toBe("JV002");
          expect(await verify(p.uid, { ...p, exp: p.exp + 1 }), `${p.name} (expiry)`).toBe("JV002");
          expect(await verify(U.sara, p), `${p.name} (another person)`).toBe("JV002");
          // the browser's review token for the very same fields: its MAC is refused by the database
          expect(await verify(p.uid, { ...p, mac: VECTORS.reviews[i]!.mac }), `${p.name} (review MAC as proof)`).toBe("JV002");
        }
      } finally {
        await admin(`update jarvis_proof_key set secret = '${original}'`);
      }
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  describe.each(KINDS)("$name: called DIRECTLY by an eligible pilot person", (k) => {
    it("(1) an INVENTED confirmation id with an invented hash/MAC writes nothing: no record, no confirmed ledger entry", async () => {
      const { call } = await k.make(U.sara);
      const before = await world();
      for (const mac of [randomBytes(32).toString("hex"), "0".repeat(64), sha256Hex(call.payload), "f".repeat(64)]) {
        const params = callArgs({ ...call, jti: id(), mac });
        expect((await rejection(send(k, U.sara, params))).code).toBe("JV002");
      }
      // the earlier shape (confirmation id, hash, payload) does not exist any more
      expect((await rejection(commit(U.sara, `select ${k.fn}('${id()}', '${sha256Hex("x")}', '{}'::jsonb)`))).code).toBe("42883");
      await sameWorld(before);
    });
    it("(2) a VALID proof with a MODIFIED payload is refused, nothing written (a changed value, trailing space, reordered keys)", async () => {
      const { call, params } = await k.make(U.sara);
      const before = await world();
      const parsed = JSON.parse(call.payload) as Record<string, unknown>;
      const reordered = JSON.stringify(Object.fromEntries(Object.entries(parsed).reverse()));
      for (const payload of [k.altPayload(call), `${call.payload} `, reordered === call.payload ? `${call.payload}\n` : reordered]) {
        const p = [...params]; p[POS.payload] = payload;
        expect((await rejection(send(k, U.sara, p))).code).toBe("JV002");
      }
      await sameWorld(before);
    });
    it("(3) an EXPIRED proof is refused, nothing written; the DATABASE clock decides (a proof valid when signed is refused once the database passes its expiry)", async () => {
      const past = await k.make(U.sara, { expires: Math.floor(Date.now() / 1000) - 5 });
      const shortLived = await k.make(U.sara, { expires: Math.floor(Date.now() / 1000) + 2 });
      const before = await world();
      expect((await rejection(send(k, U.sara, past.params))).code).toBe("JV003");
      await sleep(3200);
      expect((await rejection(send(k, U.sara, shortLived.params))).code).toBe("JV003");
      await sameWorld(before);
    });
    it("(4a) a proof issued for person A presented by person B (same company, also eligible) is refused, nothing written", async () => {
      const { params } = await k.make(U.sara);
      const before = await world();
      for (const other of [U.omar, U.founder]) expect((await rejection(send(k, other, params))).code).toBe("JV002");
      await sameWorld(before);
    });
    it("(4b) a proof presented for another COMPANY, or signed for another company, is refused, nothing written", async () => {
      const { call, params } = await k.make(U.sara);
      const before = await world();
      const p = [...params]; p[POS.company] = CO.ksa;
      expect((await rejection(send(k, U.sara, p))).code).toBe("JV002");
      const signedForKsa = proofCall({ user: U.sara, company: CO.ksa, action: k.action, target: call.target, version: call.version, payload: call.payload });
      const q = callArgs(signedForKsa); q[POS.company] = CO.uae; // the MAC says KSA, the call says UAE
      expect((await rejection(send(k, U.sara, q))).code).toBe("JV002");
      await sameWorld(before);
    });
    it("(4c) a proof for ANOTHER ACTION is refused here (a proof for action A cannot be used with wrapper B)", async () => {
      const { call } = await k.make(U.sara);
      const before = await world();
      for (const other of KINDS.filter((x) => x.action !== k.action)) {
        const wrong = proofCall({ user: U.sara, company: CO.uae, action: other.action, target: call.target, version: call.version, payload: call.payload, jti: id() });
        expect((await rejection(send(k, U.sara, callArgs(wrong)))).code, `${other.action} -> ${k.action}`).toBe("JV002");
      }
      await sameWorld(before);
    });
    it("(4d) a proof for another TARGET (a record id other than the signed one, or 'new' for a record action) is refused, nothing written", async () => {
      const { params } = await k.make(U.sara);
      const before = await world();
      const p = [...params]; p[POS.target] = k.versioned || params[POS.target] !== "new" ? id() : (id() as string);
      if (params[POS.target] === "new") {
        // a proof signed for 'new' presented with a record id
        expect((await rejection(send(k, U.sara, p))).code).toBe("JV002");
      } else {
        expect((await rejection(send(k, U.sara, p))).code).toBe("JV002");
        const q = [...params]; q[POS.target] = "new";
        expect((await rejection(send(k, U.sara, q))).code).toBe("JV002");
      }
      await sameWorld(before);
    });
    it("(5) a VALID proof works: the record exists with the real values and the ledger shows it confirmed, with approver, company, action and target", async () => {
      const { call, params, target } = await k.make(U.sara);
      const r = (await send(k, U.sara, params))[0].r as { status: string; replayed: boolean };
      expect(r).toMatchObject({ status: "done", replayed: false });
      const led = (await admin<Record<string, string>>(`select user_id, company_id, action_id, target, status, values_hash from jarvis_action_ledger where confirmation_id = '${call.jti}'`))[0];
      expect(led).toMatchObject({ user_id: U.sara, company_id: CO.uae, action_id: k.action, status: "done", target, values_hash: sha256Hex(call.payload) });
      const payload = JSON.parse(call.payload) as Record<string, unknown> & { activity?: { body: string }; follow_up?: { title: string } };
      const result = (r as unknown as { result_id?: string; opportunity_id?: string });
      if (k.fn === "jarvis_create_enquiry") {
        expect((await admin<Record<string, unknown>>(`select title, location, currency, value::float8 as value, owner_id, created_by from crm_opportunities where id = '${result.opportunity_id}'`))[0]).toMatchObject({ title: payload.title, location: "Harbour Hall", currency: "AED", value: 45000, owner_id: U.sara, created_by: U.sara });
      } else if (k.fn === "jarvis_register_organisation") {
        expect((await admin<Record<string, unknown>>(`select name, roles, created_by from crm_organisations where id = '${result.result_id}'`))[0]).toMatchObject({ name: payload.name, roles: ["agency"], created_by: U.sara });
      } else if (k.fn === "jarvis_update_enquiry") {
        expect((await admin<Record<string, unknown>>(`select location, scope from crm_opportunities where id = '${target}'`))[0]).toMatchObject({ location: "Marina Arena", scope: "Supply and operate" });
      } else if (k.fn === "jarvis_change_stage") {
        expect((await admin<Record<string, unknown>>(`select stage from crm_opportunities where id = '${target}'`))[0]).toMatchObject({ stage: "qualified" });
      } else {
        expect((await admin(`select 1 from crm_activities where opportunity_id = '${target}' and body like 'SECRET-MEETING-NOTES-4242%' and created_by = '${U.sara}'`)).length).toBe(1);
        expect((await admin(`select 1 from crm_follow_ups where opportunity_id = '${target}' and title = 'Send the proposal' and assigned_to = '${U.sara}'`)).length).toBe(1);
      }
    });
    it("(6) a retry of the same valid proof after a simulated timeout returns the ORIGINAL result and duplicates nothing; N parallel calls with one proof write exactly once", async () => {
      const { call, params } = await k.make(U.sara);
      const first = (await send(k, U.sara, params))[0].r as { status: string; result_id?: string; opportunity_id?: string; replayed: boolean };
      const after = await world();
      for (let i = 0; i < 3; i++) expect((await send(k, U.sara, params))[0].r).toMatchObject({ status: "done", replayed: true, ...(first.result_id ? { result_id: first.result_id } : { opportunity_id: first.opportunity_id }) });
      await sameWorld(after);
      const par = await k.make(U.sara);
      const b = await world();
      const rs = (await Promise.all(Array.from({ length: 10 }, () => send(k, U.sara, par.params)))).map((x) => x[0].r as { status: string; replayed: boolean });
      expect(rs.every((r) => r.status === "done")).toBe(true);
      expect(rs.filter((r) => !r.replayed)).toHaveLength(1);
      const a = await world();
      expect(Number(a.ledger)).toBe(Number(b.ledger) + 1);
      expect((await admin(`select 1 from jarvis_action_ledger where confirmation_id = '${par.call.jti}'`)).length).toBe(1);
      expect(call.jti).not.toBe(par.call.jti);
    });
    it("a replay of a proof that has meanwhile EXPIRED is refused (the database clock), and the original record is untouched", async () => {
      const { call, params } = await k.make(U.sara, { expires: Math.floor(Date.now() / 1000) + 3 });
      await send(k, U.sara, params);
      const after = await world();
      await sleep(3300);
      expect((await rejection(send(k, U.sara, params))).code).toBe("JV003");
      await sameWorld(after);
      expect((await admin(`select 1 from jarvis_action_ledger where confirmation_id = '${call.jti}' and status = 'done'`)).length).toBe(1);
    });
    it("a proof for ANOTHER person cannot even replay a used confirmation: person B gets 'not valid', and learns nothing", async () => {
      const { params } = await k.make(U.sara);
      await send(k, U.sara, params);
      expect((await rejection(send(k, U.omar, params))).code).toBe("JV002");
    });
    it("the existing CRM permission rules still run inside, unchanged: a pilot person WITHOUT a Sales grant for the company is refused with a valid proof for them, nothing written", async () => {
      const { call } = await k.make(U.sara);
      const before = await world();
      const own = proofCall({ user: U.noGrant, company: CO.uae, action: k.action, target: call.target, version: call.version, payload: call.payload });
      const p = callArgs(own);
      const e = await rejection(send(k, U.noGrant, p));
      expect(["42501", "P0002"]).toContain(e.code);
      await sameWorld(before);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  // TWO ARTEFACTS. What the browser holds after the PROPOSAL is a review token. It must be useless against every wrapper, however it is presented.
  describe.each(KINDS)("$name: the REVIEW TOKEN the browser holds is not a database proof (called DIRECTLY by an eligible pilot person)", (k) => {
    it("(a) the review token's MAC used as p_mac, with otherwise perfectly valid fields (its own jti, expiry, target, version, payload) is refused: no record, no confirmed ledger entry", async () => {
      const { call } = await k.make(U.sara);
      const rv = reviewCall({ user: U.sara, company: call.company, action: k.action, target: call.target, version: call.version, payload: call.payload, jti: call.jti, expires: call.expires });
      const before = await world();
      expect(rv.mac).not.toBe(call.mac);
      expect((await rejection(send(k, U.sara, callArgs({ ...call, mac: rv.mac })))).code).toBe("JV002");
      await sameWorld(before);
      // the very same call with the genuine database proof does work: the only difference is the artefact
      expect((await send(k, U.sara, callArgs(call)))[0].r).toMatchObject({ status: "done" });
    });
    it("(b) every other arrangement of the token is refused as well: its reviewed expiry, a fresh confirmation id, the whole token text, the decoded body as payload, the payload hash, another wrapper's token", async () => {
      const { call } = await k.make(U.sara);
      const before = await world();
      const tok = (over: Partial<ProofCall> = {}) => reviewCall({ user: U.sara, company: call.company, action: k.action, target: call.target, version: call.version, payload: call.payload, jti: call.jti, expires: call.expires, ...over });
      const base = tok();
      const body = Buffer.from(base.token.split(".")[0]!, "base64url").toString("utf8");
      const attempts: [string, unknown[]][] = [
        ["review expiry (fifteen minutes) with the review MAC", callArgs({ ...call, expires: Math.floor(Date.now() / 1000) + 900, mac: tok({ expires: Math.floor(Date.now() / 1000) + 900 }).mac })],
        ["a fresh jti with a review MAC made for it", (() => { const j2 = id(); return callArgs({ ...call, jti: j2, mac: tok({ jti: j2 }).mac }); })()],
        ["the whole token text as the MAC", callArgs({ ...call, mac: base.token })],
        ["the token's body (decoded) as the payload", callArgs({ ...call, payload: body, mac: base.mac })],
        ["the token's body (base64) as the payload", callArgs({ ...call, payload: base.token.split(".")[0]!, mac: base.mac })],
        ["the payload hash as the MAC", callArgs({ ...call, mac: sha256Hex(call.payload) })],
        ["the review MAC under the proof's own payload text with a version of zero", callArgs({ ...call, version: call.version === null ? null : 0, mac: base.mac })],
        ["a review token issued for another wrapper's action", callArgs({ ...call, mac: reviewCall({ user: U.sara, company: call.company, action: KINDS.find((x) => x.action !== k.action)!.action, target: call.target, version: call.version, payload: call.payload, jti: call.jti, expires: call.expires }).mac })],
      ];
      for (const [name, params] of attempts) expect((await rejection(send(k, U.sara, params))).code, name).toBe("JV002");
      await sameWorld(before);
    });
    it("(c) a MAC made with the wrong KEY or the wrong DOMAIN is refused: review key over the proof text, proof key over the review text, the underived secret over either text", async () => {
      const { call } = await k.make(U.sara);
      const before = await world();
      const f = { jti: call.jti, user: U.sara, company: call.company, action: k.action, target: call.target, version: call.version, expires: call.expires, payload: call.payload };
      const mac = (key: Buffer | string, text: string) => createHmac("sha256", key).update(text, "utf8").digest("hex");
      const proofT = proofText(f);
      const reviewT = proofText(f, "JARVIS-REVIEW-V1");
      // the one combination that IS the proof (proof key, proof domain) is the control: it works
      expect(mac(deriveProofKey(PROOF_KEY), proofT)).toBe(call.mac);
      for (const [name, m] of [
        ["review key + proof domain", mac(deriveReviewKey(PROOF_KEY), proofT)],
        ["proof key + review domain", mac(deriveProofKey(PROOF_KEY), reviewT)],
        ["review key + review domain (the review token itself)", mac(deriveReviewKey(PROOF_KEY), reviewT)],
        ["underived secret + proof domain (the earlier design)", mac(PROOF_KEY, proofT)],
        ["underived secret + review domain", mac(PROOF_KEY, reviewT)],
      ] as const) expect((await rejection(send(k, U.sara, callArgs({ ...call, mac: m })))).code, name).toBe("JV002");
      await sameWorld(before);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  // THE DUPLICATE ACKNOWLEDGEMENT IS SIGNED AND ENFORCED IN SQL (register organisation).
  describe("register organisation: the duplicate acknowledgement is part of the signed payload and the DATABASE decides", () => {
    const k = KINDS[1]!;
    let dupId = ""; let dupId2 = "";
    const dupName = "Fictional Duplicate Studio";
    const reg = (payload: Record<string, unknown>, o: { user?: string; jti?: string; signedAs?: Record<string, unknown> } = {}) => {
      const user = o.user ?? U.sara;
      // `signedAs`: the payload the proof was signed for, when it differs from the payload sent
      const call = proofCall({ user, company: CO.uae, action: REGISTER, target: "new", payload: o.signedAs ?? payload, ...(o.jti ? { jti: o.jti } : {}) });
      const params = callArgs({ ...call, payload: JSON.stringify(payload) });
      return { call, params, send: () => send(k, user, params) };
    };
    const registerOk = (name: string, ack: string[]) => reg(orgPayload({ name, acknowledged_org_ids: ack }));
    beforeAll(async () => {
      dupId = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => '${dupName}', p_roles => '{agency}', p_country_code => 'AE', p_website => 'https://www.duplicate-studio.example') as id`))[0].id;
      dupId2 = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => 'Fictional Second Duplicate', p_roles => '{client}', p_country_code => 'AE', p_website => 'https://second-duplicate.example') as id`))[0].id;
    });

    it("the wrapper takes ONLY the seven signed arguments: the eight-argument form with a separate acknowledgement no longer exists", async () => {
      const before = await world();
      expect((await rejection(commit(U.sara, `select jarvis_register_organisation($1::uuid, $2::uuid, 'new', null, 5::bigint, $3, $4, '[]'::jsonb)`, [id(), CO.uae, "a".repeat(64), "{}"]))).code).toBe("42883");
      for (const w of KINDS) {
        const r = await admin<{ n: number; names: string[] }>(`select pronargs::int as n, proargnames as names from pg_proc where proname = '${w.fn}' and pronamespace = 'public'::regnamespace`);
        expect(r, w.fn).toHaveLength(1);
        expect(r[0]).toEqual({ n: 7, names: ["p_confirmation", "p_company", "p_target", "p_version", "p_expires", "p_mac", "p_payload"] });
      }
      await sameWorld(before);
    });
    it("OMITTING the required acknowledgement (an empty list, or no list at all) is refused with a valid proof: no organisation, no ledger row", async () => {
      const before = await world();
      expect((await rejection(registerOk(dupName, []).send())).code).toBe("JV001");
      const { acknowledged_org_ids: _drop, ...noList } = orgPayload({ name: dupName });
      void _drop;
      expect((await rejection(reg(noList).send())).code).toBe("22023");
      await sameWorld(before);
    });
    it("CHANGING the acknowledgement (other ids), or ADDING an unrelated id to the correct one, is refused with a valid proof: nothing written", async () => {
      const before = await world();
      for (const ack of [[id()], [dupId2], [dupId, id()], [dupId, dupId2], [id(), id()]]) {
        const e = await rejection(registerOk(dupName, ack).send());
        expect(e.code, JSON.stringify(ack)).toBe("JV001");
        expect(e.message).toMatch(/acknowledgement does not match/);
      }
      await sameWorld(before);
    });
    it("a proof issued for a DIFFERENT acknowledgement is refused: the acknowledgement is inside the hash (signed for [] but sent with the ids, or the reverse)", async () => {
      const before = await world();
      const sentWithIds = reg(orgPayload({ name: dupName, acknowledged_org_ids: [dupId] }), { signedAs: orgPayload({ name: dupName, acknowledged_org_ids: [] }) });
      expect((await rejection(sentWithIds.send())).code).toBe("JV002");
      const sentEmpty = reg(orgPayload({ name: dupName, acknowledged_org_ids: [] }), { signedAs: orgPayload({ name: dupName, acknowledged_org_ids: [dupId] }) });
      expect((await rejection(sentEmpty.send())).code).toBe("JV002");
      // the same ids in another order is a different text too
      const reordered = reg(orgPayload({ name: dupName, acknowledged_org_ids: [dupId, dupId2] }), { signedAs: orgPayload({ name: dupName, acknowledged_org_ids: [dupId2, dupId] }) });
      expect((await rejection(reordered.send())).code).toBe("JV002");
      await sameWorld(before);
    });
    it("the CORRECT acknowledgement succeeds: exactly the organisations with the same name or website (by name, by website, or both at once)", async () => {
      const byName = (await registerOk("fictional duplicate studio", [dupId]).send())[0].r as { status: string; result_id: string };
      expect(byName.status).toBe("done");
      const byWebsite = (await reg(orgPayload({ name: "A Brand New Name", website: "http://duplicate-studio.example/", acknowledged_org_ids: [dupId] })).send())[0].r as { status: string };
      expect(byWebsite.status).toBe("done");
      // now THREE organisations share that website/name: the same acknowledgement is no longer enough (the new ones appeared after the review)
      const both = orgPayload({ name: "Fictional Second Duplicate", website: "https://duplicate-studio.example", acknowledged_org_ids: [dupId] });
      const before = await world();
      expect((await rejection(reg(both).send())).code).toBe("JV001");
      await sameWorld(before);
    });
    it("a duplicate that APPEARED AFTER REVIEW needs a fresh review: the proof was valid and acknowledged nothing, the database refuses; a fresh proof naming it works", async () => {
      const name = `Fictional Late Arrival ${randomBytes(3).toString("hex")}`;
      const reviewed = registerOk(name, []); // reviewed and signed while no such organisation existed
      const late = (await commit<{ id: string }>(U.founder, `select crm_create_organisation_profile(p_name => '${name}', p_roles => '{agency}', p_country_code => 'AE') as id`))[0].id;
      const before = await world();
      expect((await rejection(reviewed.send())).code).toBe("JV001");
      await sameWorld(before);
      expect((await registerOk(name, [late]).send())[0].r).toMatchObject({ status: "done" });
    });
    it("no duplicate exists and an acknowledgement is nevertheless supplied: refused (an acknowledgement names real matches only)", async () => {
      const before = await world();
      expect((await rejection(registerOk(`Fictional Unique Name ${randomBytes(3).toString("hex")}`, [dupId]).send())).code).toBe("JV001");
      await sameWorld(before);
    });
    it("a retry of a SAVED confirmation returns the ORIGINAL result before the duplicate check (the organisation it created now matches itself), with the same jti and a fresh proof", async () => {
      const name = `Fictional Retry Studio ${randomBytes(3).toString("hex")}`;
      const jti = id();
      const payload = orgPayload({ name });
      const first = (await reg(payload, { jti }).send())[0].r as { status: string; result_id: string; replayed: boolean };
      expect(first).toMatchObject({ status: "done", replayed: false });
      const after = await world();
      // FRESH proofs (new expiries, so new MACs) with the same jti and the same payload text: the ORIGINAL result, nothing written
      for (const expires of [Math.floor(Date.now() / 1000) + 120, Math.floor(Date.now() / 1000) + 121]) {
        const fresh = proofCall({ user: U.sara, company: CO.uae, action: REGISTER, target: "new", payload, jti, expires });
        expect((await send(k, U.sara, callArgs(fresh)))[0].r).toMatchObject({ status: "done", replayed: true, result_id: first.result_id });
      }
      await sameWorld(after);
    });
    it("the acknowledgement is read from the verified payload only: a payload with a malformed list (not an array, not uuids) is refused and writes nothing", async () => {
      const before = await world();
      for (const bad of ["x", 7, { a: 1 }, ["not-a-uuid"], [null]]) {
        const e = await rejection(reg(orgPayload({ name: dupName, acknowledged_org_ids: bad })).send());
        expect(["22023", "22P02"], JSON.stringify(bad)).toContain(e.code);
      }
      await sameWorld(before);
    });
    it("the proof the server issues for a confirmed acknowledgement is bound to the person and company as always (another person presenting it is refused)", async () => {
      const r = registerOk(dupName, [dupId]);
      const before = await world();
      expect((await rejection(send(k, U.omar, r.params))).code).toBe("JV002");
      await sameWorld(before);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("versioned actions: the signed version must be the record's current version", () => {
    for (const k of KINDS.filter((x) => x.versioned)) {
      it(`${k.name}: a proof signed for the version the person reviewed is refused with NOTHING written once someone else changed the record; a different version than signed is not valid`, async () => {
        const { call, params, target } = await k.make(U.sara);
        await admin(`update crm_opportunities set version = version + 1 where id = '${target}'`);
        const bumped = await versionOf(target);
        expect(bumped).toBeGreaterThan(call.version!);
        const before = await world();
        // the record moved on after the review: stale -> refused by the wrapper (40001) before any ledger row or change
        const stale = await rejection(send(k, U.sara, params));
        expect(stale.code).toBe("40001");
        await sameWorld(before);
        // presenting the CURRENT version with a proof signed for the old one is not valid either
        const p = [...params]; p[POS.version] = bumped;
        expect((await rejection(send(k, U.sara, p))).code).toBe("JV002");
        await sameWorld(before);
        // a proof signed for the current version works
        const fresh = proofCall({ user: U.sara, company: CO.uae, action: k.action, target, version: bumped, payload: call.payload });
        expect((await send(k, U.sara, callArgs(fresh)))[0].r).toMatchObject({ status: "done" });
      });
      it(`${k.name}: a proof signed WITHOUT a version is not a proof for this action`, async () => {
        const { call, target } = await k.make(U.sara);
        const noVersion = proofCall({ user: U.sara, company: CO.uae, action: k.action, target, version: null, payload: call.payload });
        const before = await world();
        expect((await rejection(send(k, U.sara, callArgs(noVersion)))).code).toBe("JV002");
        await sameWorld(before);
      });
    }
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("rotation, rollback of trust, and what a refusal by the existing CRM rules still does", () => {
    it("a refusal by the existing rules (agency role missing) after a VALID proof is still recorded once as failed and replayed, creating nothing", async () => {
      const payload = createPayload({ agency_org_id: plainOrg });
      const call = proofCall({ user: U.sara, company: CO.uae, action: CREATE, target: "new", payload });
      const before = await world();
      const r = (await commit<{ r: Record<string, unknown> }>(U.sara, wrapperSql("jarvis_create_enquiry"), callArgs(call)))[0].r;
      expect(r).toMatchObject({ status: "failed", error_code: "22023", replayed: false, opportunity_id: null });
      const after = await world();
      expect(after.opps).toBe(before.opps);
      expect(after.counters).toBe(before.counters);
      expect(Number(after.ledger)).toBe(Number(before.ledger) + 1);
      expect(after.confirmed).toBe(before.confirmed); // a refused write is not a confirmed one
      expect((await commit<{ r: Record<string, unknown> }>(U.sara, wrapperSql("jarvis_create_enquiry"), callArgs(call)))[0].r).toMatchObject({ status: "failed", replayed: true });
      await sameWorld(after);
    });
    it("rotating the key: outstanding proofs stop working at once (nothing written), proofs signed with the new key work, and with the key cleared everything fails closed again", async () => {
      const K2 = "rotated-proof-key-2-0123456789-abcdefghij";
      const old = await KINDS[0]!.make(U.sara);
      const before = await world();
      await admin(`select jarvis_set_proof_key('${K2}')`);
      try {
        expect((await rejection(send(KINDS[0]!, U.sara, old.params))).code).toBe("JV002");
        await sameWorld(before);
        const fresh = await KINDS[0]!.make(U.sara, { key: K2 });
        expect((await send(KINDS[0]!, U.sara, fresh.params))[0].r).toMatchObject({ status: "done" });
        await admin(`delete from jarvis_proof_key`);
        const again = await KINDS[0]!.make(U.sara, { key: K2 });
        expect((await rejection(send(KINDS[0]!, U.sara, again.params))).code).toBe("JV004");
      } finally {
        await admin(`select jarvis_set_proof_key('${PROOF_KEY}')`);
      }
      expect((await send(KINDS[0]!, U.sara, (await KINDS[0]!.make(U.sara)).params))[0].r).toMatchObject({ status: "done" });
    });
    it("switches still apply on top of the proof: JARVIS off or writes off refuses a perfectly valid proof, nothing written", async () => {
      const { params } = await KINDS[1]!.make(U.sara);
      const before = await world();
      await admin(`update jarvis_settings set writes_enabled = false`);
      expect((await rejection(send(KINDS[1]!, U.sara, params))).code).toBe("42501");
      await admin(`update jarvis_settings set writes_enabled = true, enabled = false`);
      expect((await rejection(send(KINDS[1]!, U.sara, params))).code).toBe("42501");
      await admin(`update jarvis_settings set enabled = true`);
      await sameWorld(before);
      expect((await send(KINDS[1]!, U.sara, params))[0].r).toMatchObject({ status: "done" });
    });
    it("an ineligible person (not on the pilot list) is refused even with a valid proof for them", async () => {
      const call = proofCall({ user: U.outsider, company: CO.uae, action: REGISTER, target: "new", payload: orgPayload() });
      const before = await world();
      expect((await rejection(commit(U.outsider, wrapperSql("jarvis_register_organisation"), callArgs(call)))).code).toBe("42501");
      await sameWorld(before);
    });
  });

  // -----------------------------------------------------------------------------------------------------------------------------------------------------------
  describe("bookkeeping writes: what a direct call can and cannot do", () => {
    it("jarvis_usage_take is bound to the caller (auth.uid()): a direct call only moves the caller's OWN counter; it creates no business record and cannot touch another person's counter or the ledger", async () => {
      const before = await world();
      const others = await admin<{ n: string }>(`select count(*)::text n from jarvis_usage where user_id <> '${U.omar}'`);
      const r = await commit<{ allowed: boolean; used: number }>(U.omar, `select * from jarvis_usage_take(500)`);
      expect(r[0].allowed).toBe(true);
      expect((await admin<{ n: string }>(`select count(*)::text n from jarvis_usage where user_id <> '${U.omar}'`))[0].n).toBe(others[0].n);
      expect((await admin<{ requests: number }>(`select requests from jarvis_usage where user_id = '${U.omar}'`))[0].requests).toBe(r[0].used);
      await sameWorld(before);
      // there is no argument that names another person
      expect((await rejection(commit(U.omar, `select * from jarvis_usage_take(5, '${U.sara}')`))).code).toBe("42883");
      // and an ineligible person cannot count anything at all
      expect((await rejection(commit(U.outsider, `select * from jarvis_usage_take(5)`))).code).toBe("42501");
    });
    it("the ledger cannot be written, and the internal helpers (ledger enter/done/fail) cannot be called, by a signed-in person: a direct 'confirmed' row is impossible", async () => {
      const before = await world();
      for (const sql of [
        `insert into jarvis_action_ledger (confirmation_id, user_id, company_id, action_id, target, values_hash, status) values ('${id()}', '${U.sara}', '${CO.uae}', '${CREATE}', 'new', '${"a".repeat(64)}', 'done')`,
        `update jarvis_action_ledger set status = 'done'`, `delete from jarvis_action_ledger`,
        `select jarvis_ledger_enter('${id()}', '${"a".repeat(64)}', '${CREATE}', '${CO.uae}', 'new')`, `select jarvis_ledger_done('${id()}', '${id()}', 'x', null)`, `select jarvis_ledger_fail('${id()}', 'x', 'y')`,
      ]) expect((await rejection(commit(U.sara, sql))).message, sql).toMatch(/permission denied|row-level security/);
      await sameWorld(before);
    });
  });
});
