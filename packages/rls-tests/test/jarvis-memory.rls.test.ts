import { readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// Migration 20261226000100_jarvis_memory_suggestions.sql and the read the JARVIS lookup "Show my overdue Sales follow-ups" makes, against a real Postgres. Fictional data only.
//   * personal memory: a person reaches ONLY their own preferences, only the closed set of pairs can be stored, a deleted preference is gone, people outside the pilot and
//     anonymous callers are refused, and there is no direct table access;
//   * suggestions: stored for review, invisible to other people, bounded;
//   * the lookup's exact query, as two people with different company access: each sees only their own follow-ups in a company they hold a Sales grant for, and a company
//     the requester cannot see returns nothing even when asked for by id;
//   * the owner pack: preflight, verify, rollback twice; the earlier JARVIS verifier stays all OK with the migration applied.
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const pack = (f: string) => readFileSync(path.join(__dirname, "../../../supabase/manual-sql", f), "utf8");
const id = () => randomUUID();
const CO = { uae: id(), ksa: id() };
const U = { sara: id(), omar: id(), ksaStaff: id(), outsider: id() };

describe("JARVIS memory, suggestions and the overdue follow-ups read", () => {
  const db = new RlsTestDatabase();
  const commit = <T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) => db.asUserCommit(user, async (query) => (await query(sql, params)).rows as T[]);
  const admin = async <T = Record<string, unknown>>(sql: string) => (await db.seed(sql)).rows as T[];
  const rejection = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as { code?: string; message: string }; } throw new Error("expected a refusal, but the call succeeded"); };
  const prefs = (user: string) => commit<{ pref_key: string; pref_value: string }>(user, `select pref_key, pref_value from jarvis_pref_list()`);
  /** The query lib/jarvis/sales/followups-overdue.ts runs through the person's own session. */
  const lookup = (user: string, company: string) => commit<{ title: string }>(user, `select id, title, kind, due_at, opportunity_id, company_id from crm_follow_ups where status = 'open' and assigned_to = $1 and company_id = $2 and due_at < now() order by due_at limit 26`, [user, company]);

  beforeAll(async () => {
    await db.setup();
    await db.seed(`
      insert into countries (code, name, default_currency) values ('AE', 'United Arab Emirates', 'AED'), ('SA', 'Saudi Arabia', 'SAR') on conflict do nothing;
      insert into companies (id, legal_name, country_code, default_currency) values ('${CO.uae}', 'Fictional Enginious UAE LLC', 'AE', 'AED'), ('${CO.ksa}', 'Fictional Enginious KSA LLC', 'SA', 'SAR');
      insert into auth.users (id, email) values ${Object.entries(U).map(([k, v]) => `('${v}', '${k}@jarvis-memory-test.ae')`).join(", ")};
      insert into crm_company_settings (company_id, reference_code, default_quote_currency) values ('${CO.uae}', 'UAE', 'AED'), ('${CO.ksa}', 'KSA', 'SAR');
      insert into crm_company_grants (user_id, company_id, capabilities) values ('${U.sara}', '${CO.uae}', '{founder}'), ('${U.omar}', '${CO.uae}', '{}'), ('${U.ksaStaff}', '${CO.ksa}', '{founder}');
      update jarvis_settings set enabled = true, writes_enabled = true;
      insert into jarvis_pilot_users (user_id) values ('${U.sara}'), ('${U.omar}'), ('${U.ksaStaff}');
    `);
    await db.seed(`update profiles set is_active = true where id in ('${U.sara}', '${U.omar}', '${U.ksaStaff}', '${U.outsider}')`);
    const SOON = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const mk = async (user: string, company: string, title: string) => {
      const org = (await commit<{ id: string }>(user, `select crm_create_organisation_profile(p_name => $1, p_roles => '{client}', p_country_code => 'AE') as id`, [`Fictional client for ${title}`]))[0]!.id;
      return (await commit<{ id: string }>(user, `select crm_create_opportunity(p_company_id => $1, p_title => $2, p_source => 'whatsapp', p_next_title => $3, p_next_due => $4, p_client_org_id => $5) as id`, [company, title, `Call about ${title}`, SOON, org]))[0]!.id;
    };
    const a = await mk(U.sara, CO.uae, "Fictional harbour gala");
    await mk(U.sara, CO.uae, "Fictional desert launch"); // its follow-up stays in the future: not overdue
    const b = await mk(U.ksaStaff, CO.ksa, "Fictional Riyadh expo");
    // Make one follow-up of each company overdue, and give Omar an overdue one of his own on Sara's enquiry.
    await db.seed(`
      update crm_follow_ups set due_at = now() - interval '3 days' where opportunity_id in ('${a}', '${b}');
      insert into crm_follow_ups (opportunity_id, company_id, assigned_to, title, kind, due_at, created_by) values ('${a}', '${CO.uae}', '${U.omar}', 'Omar fictional follow-up', 'call', now() - interval '1 day', '${U.omar}');
    `);
  });
  afterAll(async () => { await db.teardown(); });

  describe("personal memory", () => {
    it("a saved preference is listed for its owner in a new session, and nobody else sees it", async () => {
      await commit(U.sara, `select jarvis_pref_set('email_length', 'short')`);
      await commit(U.sara, `select jarvis_pref_set('english', 'british')`);
      expect(await prefs(U.sara)).toEqual([{ pref_key: "email_length", pref_value: "short" }, { pref_key: "english", pref_value: "british" }]); // a separate connection = a new session
      expect(await prefs(U.omar)).toEqual([]);
      expect(await prefs(U.ksaStaff)).toEqual([]);
    });
    it("setting the same key again edits it; another person's value is their own", async () => {
      await commit(U.sara, `select jarvis_pref_set('email_length', 'detailed')`);
      await commit(U.omar, `select jarvis_pref_set('email_length', 'medium')`);
      expect((await prefs(U.sara)).find((p) => p.pref_key === "email_length")?.pref_value).toBe("detailed");
      expect(await prefs(U.omar)).toEqual([{ pref_key: "email_length", pref_value: "medium" }]);
    });
    it("only the closed set can be stored: free text, an unknown key and an unknown value are refused", async () => {
      for (const [k, v] of [["note", "my passport is X1234567"], ["email_length", "Sara's salary is AED 18,500"], ["tone", "angry"], ["english", ""]]) {
        expect((await rejection(commit(U.sara, `select jarvis_pref_set($1, $2)`, [k, v]))).code).toBe("23514");
      }
      expect((await admin<{ n: string }>(`select count(*)::text n from jarvis_preferences where pref_key not in ('email_length', 'english', 'tone', 'answer_length')`))[0]!.n).toBe("0");
    });
    it("deleting removes it for good, and only the caller's own row", async () => {
      await commit(U.sara, `select jarvis_pref_delete('english')`);
      await commit(U.sara, `select jarvis_pref_delete('email_length')`);
      expect(await prefs(U.sara)).toEqual([]);
      expect(await prefs(U.omar)).toEqual([{ pref_key: "email_length", pref_value: "medium" }]);
    });
    it("no direct table access, nobody outside the pilot, nobody anonymous", async () => {
      expect((await rejection(commit(U.omar, `select * from jarvis_preferences`))).code).toBe("42501");
      expect((await rejection(commit(U.omar, `insert into jarvis_preferences (user_id, pref_key, pref_value) values ($1, 'tone', 'formal')`, [U.sara]))).code).toBe("42501");
      expect((await rejection(commit(U.omar, `delete from jarvis_preferences`))).code).toBe("42501");
      expect((await rejection(commit(U.outsider, `select * from jarvis_pref_list()`))).code).toBe("42501");
      expect((await rejection(commit(U.outsider, `select jarvis_pref_set('tone', 'formal')`))).code).toBe("42501");
      expect(await rejection(commit(null, `select * from jarvis_pref_list()`))).toBeTruthy();
    });
    it("the main switch off closes memory too", async () => {
      await admin(`update jarvis_settings set enabled = false`);
      expect((await rejection(prefs(U.omar))).code).toBe("42501");
      await admin(`update jarvis_settings set enabled = true`);
    });
  });

  describe("suggested corrections", () => {
    it("is stored as pending for review, with the author, and other people cannot read it", async () => {
      await commit(U.omar, `select jarvis_suggest_correction('sales-follow-ups', 'The button is now called Plan next step.')`);
      const rows = await admin<{ topic_id: string; status: string; user_id: string }>(`select topic_id, status, user_id from jarvis_knowledge_suggestions`);
      expect(rows).toEqual([{ topic_id: "sales-follow-ups", status: "pending", user_id: U.omar }]);
      expect((await rejection(commit(U.sara, `select * from jarvis_knowledge_suggestions`))).code).toBe("42501");
      expect((await db.seed(pack("jarvis_memory_30_suggestions_review_readonly.sql"))).rows).toHaveLength(1);
    });
    it("refuses a malformed topic, an empty or oversized text, people outside the pilot, and more than 20 pending", async () => {
      expect((await rejection(commit(U.omar, `select jarvis_suggest_correction('Bad Topic!', 'some text here')`))).code).toBe("23514");
      expect((await rejection(commit(U.omar, `select jarvis_suggest_correction('sales-follow-ups', '  ')`))).code).toBe("23514");
      expect((await rejection(commit(U.omar, `select jarvis_suggest_correction('sales-follow-ups', $1)`, ["x".repeat(1001)]))).code).toBe("23514");
      expect((await rejection(commit(U.outsider, `select jarvis_suggest_correction('sales-follow-ups', 'some text here')`))).code).toBe("42501");
      for (let i = 0; i < 19; i++) await commit(U.omar, `select jarvis_suggest_correction('sales-follow-ups', $1)`, [`Fictional suggestion ${i}`]);
      expect((await rejection(commit(U.omar, `select jarvis_suggest_correction('sales-follow-ups', 'one too many')`))).code).toBe("54000");
    });
  });

  describe("the overdue follow-ups read (company and record scope)", () => {
    it("each person sees only their OWN overdue follow-ups in a company they hold a Sales grant for", async () => {
      expect((await lookup(U.sara, CO.uae)).map((r) => r.title)).toEqual(["Call about Fictional harbour gala"]);
      expect((await lookup(U.omar, CO.uae)).map((r) => r.title)).toEqual(["Omar fictional follow-up"]);
      expect((await lookup(U.ksaStaff, CO.ksa)).map((r) => r.title)).toEqual(["Call about Fictional Riyadh expo"]);
    });
    it("a company the requester cannot see returns nothing, even when asked for by id or for another person's rows", async () => {
      expect(await lookup(U.sara, CO.ksa)).toEqual([]);
      expect(await lookup(U.ksaStaff, CO.uae)).toEqual([]);
      expect(await commit(U.sara, `select id from crm_follow_ups where company_id = $1`, [CO.ksa])).toEqual([]);
      expect(await commit(U.sara, `select id from crm_opportunities where company_id = $1`, [CO.ksa])).toEqual([]);
      expect(await lookup(U.outsider, CO.uae)).toEqual([]);
    });
    it("a revoked grant stops the next lookup", async () => {
      await admin(`update crm_company_grants set revoked_at = now() where user_id = '${U.omar}'`);
      expect(await lookup(U.omar, CO.uae)).toEqual([]);
    });
  });

  describe("owner pack", () => {
    const bad = (rows: { result?: string }[]) => rows.filter((r) => /^(FAIL|STOP|MISSING|WRONG)/.test(String(r.result)));
    it("verify is all OK, and the earlier JARVIS verifier is still all OK with this migration applied", async () => {
      expect(bad((await db.seed(pack("jarvis_memory_20_verify_readonly.sql"))).rows)).toEqual([]);
      expect(bad((await db.seed(pack("jarvis_20_verify_readonly.sql"))).rows)).toEqual([]);
    });
    it("rollback (twice) removes only the new objects; JARVIS still answers; preflight says not installed; re-apply works", async () => {
      await db.seed(pack("jarvis_memory_90_rollback.sql"));
      await db.seed(pack("jarvis_memory_90_rollback.sql"));
      expect((await admin<{ t: boolean }>(`select to_regclass('public.jarvis_preferences') is null as t`))[0]!.t).toBe(true);
      expect((await commit<{ is_available: boolean }>(U.sara, `select * from jarvis_my_access()`))[0]!.is_available).toBe(true);
      expect((await db.seed(pack("jarvis_memory_00_preflight_readonly.sql"))).rows.map((r) => r.result)).toEqual(["OK", "OK", "not installed yet", "not installed yet"]);
      expect(bad((await db.seed(pack("jarvis_20_verify_readonly.sql"))).rows)).toEqual([]);
      await db.applyMigration("20261226000100_jarvis_memory_suggestions.sql");
      await db.applyMigration("20261226000100_jarvis_memory_suggestions.sql");
      expect(bad((await db.seed(pack("jarvis_memory_20_verify_readonly.sql"))).rows)).toEqual([]);
    });
  });
});
