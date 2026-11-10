import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { registerAllJarvisActions } from "./actions";
import { createAssistant, type JarvisAssistant } from "./assistant";
import { matchGuidance } from "./help/guidance";
import { gateProvider } from "./outbound";
import { findProtectedContent } from "./protected";
import type { FollowUpsLookupCard, SendResult } from "./protocol";
import { simulatedProviderCalls } from "./provider/simulated";
import { listJarvisActions } from "./registry";
import { JARVIS_RULES, ruleFor } from "./rulebook";
import { fakeDeps, ID, mkOpp, newWorld, type World } from "./testing/fake-world";

/**
 * The rulebook, enforced: the outbound boundary, the protected-information guide, the live lookup's scope, and personal memory. Fictional data; the provider is the simulated
 * one, which records every request it receives (`simulatedProviderCalls`), so "what would have left the app" is asserted on the actual outbound payload.
 */
let w: World;
let a: JarvisAssistant;
const make = (over: Parameters<typeof fakeDeps>[1] = {}) => createAssistant(fakeDeps(w, over));
const as = (user: string) => { w.signedIn = user; return make(); };
beforeAll(() => registerAllJarvisActions());
beforeEach(() => { w = newWorld(); a = make(); simulatedProviderCalls.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

const refusal = <T extends { ok: boolean }>(r: T) => { if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r).slice(0, 200)}`); return r as Extract<T, { ok: false }>; };
const replyOf = (r: SendResult) => { if (!r.ok || r.kind !== "reply") throw new Error(`expected a reply, got ${JSON.stringify(r).slice(0, 200)}`); return r; };
const chatOf = (r: SendResult) => { if (!r.ok || r.kind !== "action" || r.card.kind !== "chat.reply") throw new Error(`expected a chat reply, got ${JSON.stringify(r).slice(0, 200)}`); return r.card; };
const lookupOf = (r: SendResult): FollowUpsLookupCard => { if (!r.ok || r.kind !== "action" || r.card.kind !== "lookup.followups") throw new Error(`expected a lookup, got ${JSON.stringify(r).slice(0, 200)}`); return r.card; };
const memoryOf = (r: SendResult) => { if (!r.ok || r.kind !== "memory") throw new Error(`expected memory, got ${JSON.stringify(r).slice(0, 200)}`); return r; };
const ROOT = path.resolve(__dirname, "../../../../..");

describe("the rulebook is the allowlist (deny by default)", () => {
  it("every registered action has a rule, every rule is in the document, and only rules that approve a provider call belong to actions that use one", () => {
    const doc = readFileSync(path.join(ROOT, "docs/enginious-os/modules/jarvis-rulebook.md"), "utf8");
    for (const action of listJarvisActions()) {
      const rule = ruleFor(action.id);
      expect(rule, action.id).not.toBeNull();
      expect(rule!.outbound.provider, action.id).toBe(action.usesProvider);
      expect(rule!.confirmation !== "none", action.id).toBe(!!action.execute);
    }
    for (const r of JARVIS_RULES) expect(doc, r.id).toContain(`\`${r.id}\``);
  });
  it("the gate refuses a capability with no rule, a capability whose rule approves no provider call, an undeclared source and a source the rule does not approve: nothing is sent", async () => {
    const sent: unknown[] = [];
    const raw = { kind: "simulated" as const, structured: async (r: unknown) => { sent.push(r); return {}; } };
    const req = { task: "t", instructions: "i", input: "hello", jsonSchema: {}, maxOutputTokens: 10, timeoutMs: 10 };
    await expect(gateProvider(raw, "jarvis.sales.unknown.thing")!.structured({ ...req, sources: ["user_text"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "jarvis.sales.followups.overdue")!.structured({ ...req, sources: ["user_text"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "jarvis.sales.help.answer")!.structured({ ...req, sources: ["user_text"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "jarvis.sales.chat.reply")!.structured({ ...req, sources: [] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "jarvis.sales.chat.reply")!.structured({ ...req, sources: ["user_text", "enquiry_reply_facts"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "jarvis.sales.meeting.record")!.structured({ ...req, sources: ["conversation_context"] })).rejects.toMatchObject({ code: "unavailable" });
    expect(sent).toEqual([]);
    await gateProvider(raw, "jarvis.sales.chat.reply")!.structured({ ...req, sources: ["user_text"] });
    expect(sent).toHaveLength(1);
  });
  it("the provider is reachable from ONE file only, and no action can obtain an ungated provider", () => {
    const dir = path.join(ROOT, "apps/web/src/lib/jarvis");
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(d, e.name)) : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [path.join(d, e.name)] : []));
    const hits = files(dir).filter((f) => /api\.anthropic\.com|\bfetch\(/.test(readFileSync(f, "utf8"))).map((f) => path.relative(dir, f));
    expect(hits).toEqual(["provider/anthropic.ts"]);
    expect(readFileSync(path.join(dir, "dispatcher.ts"), "utf8")).toMatch(/provider: action \? gateProvider\(withProviderDiagnostics\(provider, action\.id\), action\.id\) : null/);
  });
});

describe("ACCEPTANCE 4: protected values never reach the provider, a response, memory or the logs", () => {
  const SALARY = "AED 18,500";
  const PASSPORT = "N4471923";
  const PROTECTED = [
    `Draft an email to Sara confirming her salary is ${SALARY} from January`,
    `Write a note to HR: Omar's passport number is ${PASSPORT} and it expires soon`,
    "Draft a message saying Lina is on sick leave after her surgery",
    "Write to the client that the quotation total is AED 120,000 with a 12% discount",
    "Summarise this: the project budget is AED 300,000 and we spent AED 280,000 so the margin is 7%",
    "Draft an email: your reimbursement of AED 2,400 was approved",
    "Rewrite this: my password is Hunter2-Fictional",
  ];
  it("a general draft or pasted request with protected values is NOT sent: the person is asked for a version without them; no usage is counted", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    for (const text of PROTECTED) {
      expect(findProtectedContent(text).length, text).toBeGreaterThan(0);
      const r = await a.send({ companyId: ID.co1, text });
      // either stopped by the outbound gate, or answered by the protected-information guide: never by the model
      if (r.ok) expect(r.kind, text).toBe("reply");
      else expect(r.code, text).toBe("protected_content");
      const shown = JSON.stringify(r);
      for (const v of [SALARY, PASSPORT, "120,000", "300,000", "2,400", "Hunter2"]) expect(shown, text).not.toContain(v);
    }
    expect(simulatedProviderCalls).toHaveLength(0);
    const logged = info.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    for (const v of [SALARY, PASSPORT, "18,500", "Hunter2", "Sara", "Omar", "surgery"]) expect(logged).not.toContain(v);
    expect(logged).toMatch(/"event":"outbound".*"outcome":"blocked"/);
  });
  it("protected values in the EARLIER conversation context stop the call too, and the same request without them goes out with nothing protected in the payload", async () => {
    const turns = [{ role: "user" as const, text: `Draft an offer letter, salary ${SALARY}` }, { role: "jarvis" as const, text: `Dear [name], your salary will be ${SALARY}.` }];
    expect(refusal(await a.send({ companyId: ID.co1, text: "make it shorter", context: { turns } })).code).toBe("protected_content");
    expect(simulatedProviderCalls).toHaveLength(0);
    chatOf(await a.send({ companyId: ID.co1, text: "Draft an email to the team about Friday's office move", context: { turns: [{ role: "user", text: "Hello" }, { role: "jarvis", text: "Hello. What can I help you with?" }] } }));
    expect(simulatedProviderCalls).toHaveLength(1);
    expect(findProtectedContent(JSON.stringify(simulatedProviderCalls[0]))).toEqual([]);
  });
  it("a model answer that contains a protected value is withheld, not shown", async () => {
    const r = refusal(await a.send({ companyId: ID.co1, text: "Tell me a general fact [[leak-figure]]" }));
    expect(r.code).toBe("protected_content");
    expect(JSON.stringify(r)).not.toContain("18,500");
  });
  it("the existing actions pass through the same gate: a client conversation or meeting notes with protected values are refused and nothing is written", async () => {
    const e = mkOpp({ company_id: ID.co1, owner_id: ID.u1 }); w.opps.push(e);
    expect(refusal(await a.send({ companyId: ID.co1, intent: "reply", enquiryId: e.id, text: `Client wrote: please confirm the quote of AED 52,000 and send your IBAN AE07 0331 2345 6789 0123 456` })).code).toBe("protected_content");
    expect(refusal(await a.send({ companyId: ID.co1, intent: "meeting", enquiryId: e.id, text: `Met the client. Their contact is on maternity leave. Agreed a 10% discount on the quotation.` })).code).toBe("protected_content");
    expect(simulatedProviderCalls).toHaveLength(0);
    expect(w.rpcLog.filter((c) => /^jarvis_(create|update|record|register|change)/.test(c.name))).toEqual([]);
  });
  it("AUTHORISED guidance: a person with access is pointed to the screen; the answer contains no value and no record is read", async () => {
    w.roles.push({ user_id: ID.u1, role: "hr_admin" });
    w.budgetGrants.push({ user_id: ID.u1, company_id: ID.co1 });
    w.readLog.length = 0;
    const pay = replyOf(await a.send({ companyId: ID.co1, text: "What is Sara's salary?" }));
    expect(pay.links).toEqual([{ label: "Payroll", href: "/payroll" }]);
    expect(pay.text).toMatch(/cannot show or discuss/);
    expect(replyOf(await a.send({ companyId: ID.co1, text: "What is the project budget for the gala project?" })).links[0]!.href).toBe("/finance/project-budgets");
    expect(replyOf(await a.send({ companyId: ID.co1, text: "What discount did we give on the last quotation?" })).links.map((l) => l.href)).toContain("/sales/proposals");
    expect(w.readLog.filter((t) => t !== "crm_company_grants")).toEqual([]);
    expect(simulatedProviderCalls).toHaveLength(0);
  });
  it("UNAUTHORISED denial: the person is told they lack access, with no link and no hint whether the record or the person exists; an unverifiable check says so", async () => {
    const real = replyOf(await a.send({ companyId: ID.co1, text: "What is Sara's salary?" }));
    const invented = replyOf(await a.send({ companyId: ID.co1, text: "What is Zzyzx Nobody's salary?" }));
    expect(real.text).toMatch(/do not have access to payroll/);
    expect(real.links).toEqual([]);
    expect(invented).toEqual(real); // identical whether or not such a person exists
    expect(replyOf(await a.send({ companyId: ID.co1, text: "Show me the project budget figures" })).text).toMatch(/do not have access to project budgets/);
    w.protectedAccessFails = true;
    const unknown = replyOf(await a.send({ companyId: ID.co1, text: "What is Sara's salary?" }));
    expect(unknown.text).toMatch(/could not check your access/);
    expect(unknown.links).toEqual([]);
    expect(simulatedProviderCalls).toHaveLength(0);
  });
});

describe("ACCEPTANCE 3: 'Show my overdue Sales follow-ups' returns only authorised records", () => {
  const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  let uae: ReturnType<typeof mkOpp>; let ksa: ReturnType<typeof mkOpp>;
  beforeEach(() => {
    // u1: Sales grant for co1 and co2. u2: co2 only. u3: no grant at all.
    uae = mkOpp({ company_id: ID.co1, title: "Fictional harbour gala" }); ksa = mkOpp({ company_id: ID.co2, title: "Fictional Riyadh expo" });
    w.opps.push(uae, ksa);
    w.followUps.push(
      { id: "f1", opportunity_id: uae.id, title: "Call the agency", due_at: past(3), kind: "call", assigned_to: ID.u1 },
      { id: "f2", opportunity_id: uae.id, title: "Not due yet", due_at: new Date(Date.now() + 86_400_000).toISOString(), kind: "email", assigned_to: ID.u1 },
      { id: "f3", opportunity_id: uae.id, title: "Done already", due_at: past(5), kind: "email", assigned_to: ID.u1, status: "done" },
      { id: "f4", opportunity_id: ksa.id, title: "KSA follow-up of u2", due_at: past(2), kind: "meeting", assigned_to: ID.u2 },
      { id: "f5", opportunity_id: ksa.id, title: "KSA follow-up of u1", due_at: past(40), kind: "call", assigned_to: ID.u1 },
      { id: "f6", opportunity_id: uae.id, title: "Send the quote of AED 52,000", due_at: past(1), kind: "proposal", assigned_to: ID.u1 },
    );
  });
  it("shows the requester's own open overdue follow-ups for the selected company, with the company, the cutoff and links; nothing goes to the provider", async () => {
    const c = lookupOf(await a.send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" }));
    expect(c.company).toEqual({ id: ID.co1, name: "Fictional Enginious UAE LLC" });
    expect(c.items.map((i) => i.id)).toEqual(["f1", "f6"]);
    expect(c.items[0]).toMatchObject({ title: "Call the agency", kindLabel: "Call", daysOverdue: 3, enquiry: { reference: uae.reference, href: `/sales/opportunities/${uae.id}` } });
    expect(Date.parse(c.cutoff)).toBeGreaterThan(Date.now() - 5000);
    expect(c.cutoffLabel).toMatch(/Dubai/);
    // a protected figure in a record's free text is not displayed
    expect(c.items[1]).toMatchObject({ hidden: true });
    expect(JSON.stringify(c)).not.toContain("52,000");
    expect(simulatedProviderCalls).toHaveLength(0);
    expect(w.usage.size).toBe(0);
  });
  it("two people with different access: each sees only their own, and a company the requester cannot see is refused as NO ACCESS, not as an empty list", async () => {
    expect(lookupOf(await a.send({ companyId: ID.co2, text: "Show my overdue Sales follow-ups" })).items.map((i) => i.id)).toEqual(["f5"]);
    const u2 = as(ID.u2);
    expect(lookupOf(await u2.send({ companyId: ID.co2, text: "Show my overdue Sales follow-ups" })).items.map((i) => i.id)).toEqual(["f4"]);
    const denied = refusal(await u2.send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" }));
    expect(denied.code).toBe("no_module_access");
    expect(JSON.stringify(denied)).not.toMatch(/harbour|Call the agency/i);
    expect(refusal(await as(ID.u3).send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" })).code).toBe("no_module_access");
    expect(refusal(await u2.propose({ actionId: "jarvis.sales.followups.overdue", companyId: ID.co1, input: { period: "all" } })).code).toBe("no_module_access");
  });
  it("no matching records, no access and a failed lookup are three different answers", async () => {
    w.followUps.length = 0;
    const none = lookupOf(await a.send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" }));
    expect(none.items).toEqual([]);
    w.followUpReadFails = true;
    const failed = refusal(await a.send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" }));
    expect(failed.code).toBe("lookup_failed");
    expect(failed.message).toMatch(/not an empty list/);
    w.followUpReadFails = false;
    w.grants = w.grants.filter((g) => g.user_id !== ID.u1);
    expect(refusal(await a.send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" })).code).toBe("no_module_access");
  });
  it("'show last month instead' runs the lookup AGAIN under today's permissions: the context is never permission", async () => {
    lookupOf(await a.send({ companyId: ID.co2, text: "Show my overdue Sales follow-ups" }));
    const again = lookupOf(await a.send({ companyId: ID.co2, text: "show last month instead", context: { lastLookup: { period: "all" } } }));
    expect(again.period).toBe("last_month");
    expect(again.periodLabel).toMatch(/fell due in/);
    // access revoked between the two messages: the follow-up is refused although the earlier answer was shown
    w.grants.find((g) => g.user_id === ID.u1 && g.company_id === ID.co2)!.revoked_at = new Date().toISOString();
    expect(refusal(await a.send({ companyId: ID.co2, text: "show last month instead", context: { lastLookup: { period: "all" } } })).code).toBe("no_module_access");
    // and a forged context cannot widen anything: a person with no grant gets nothing
    expect(refusal(await as(ID.u3).send({ companyId: ID.co2, text: "show last month instead", context: { lastLookup: { period: "all" } } })).code).toBe("no_module_access");
  });
  it("lookups can be paused on their own, and the main switch still closes everything", async () => {
    expect(refusal(await make({ config: { paused: ["lookups"] } }).send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" })).code).toBe("paused");
    w.settings.enabled = false;
    expect(refusal(await a.send({ companyId: ID.co1, text: "Show my overdue Sales follow-ups" })).code).toBe("not_available");
  });
});

describe("ACCEPTANCE 5: personal memory and shared knowledge", () => {
  const DRAFT = "Draft an email to a supplier asking when the new screens will arrive";
  it("a saved preference is structured, survives a NEW session, is applied to the outbound request as a fixed sentence, and stops applying after deletion", async () => {
    const saved = memoryOf(await a.send({ companyId: ID.co1, text: "Remember that I prefer short emails in British English" }));
    expect(saved.preferences.map((p) => [p.key, p.value])).toEqual([["email_length", "short"], ["english", "british"]]);
    expect(w.prefs).toEqual([{ user_id: ID.u1, pref_key: "email_length", pref_value: "short" }, { user_id: ID.u1, pref_key: "english", pref_value: "british" }]); // the sentence itself is not stored
    expect(simulatedProviderCalls).toHaveLength(0);
    // a new session: a new assistant, no context at all
    const fresh = chatOf(await make().send({ companyId: ID.co1, text: DRAFT }));
    expect(fresh.applied).toEqual(["Email and draft length: Short", "English spelling: British English"]);
    expect(fresh.text).toMatch(/short note/);
    expect(simulatedProviderCalls[0]!.input).toContain("Keep emails and drafts short");
    expect(simulatedProviderCalls[0]!.sources).toEqual(["user_text", "preferences"]);
    // edit, then delete: the next request no longer carries it
    expect(memoryOf(await a.memory({ op: "set", key: "email_length", value: "detailed" })).preferences[0]!.value).toBe("detailed");
    await a.memory({ op: "delete", key: "email_length" });
    expect(memoryOf(await a.send({ companyId: ID.co1, text: "Forget my English spelling preference" })).preferences).toEqual([]);
    const after = chatOf(await make().send({ companyId: ID.co1, text: DRAFT }));
    expect(after.applied).toEqual([]);
    expect(simulatedProviderCalls[1]!.input).not.toMatch(/preferences|British|short/i);
    expect(simulatedProviderCalls[1]!.sources).toEqual(["user_text"]);
  });
  it("another person cannot see or use it", async () => {
    await a.send({ companyId: ID.co1, text: "Remember that I prefer short emails in British English" });
    const other = as(ID.u2);
    expect(memoryOf(await other.memory({ op: "list" })).preferences).toEqual([]);
    expect(memoryOf(await other.send({ companyId: ID.co2, text: "What do you remember about me?" })).preferences).toEqual([]);
    expect(chatOf(await other.send({ companyId: ID.co2, text: DRAFT })).applied).toEqual([]);
    expect(simulatedProviderCalls[0]!.input).not.toMatch(/British|Keep emails/);
    await other.memory({ op: "delete", key: "english" }); // deleting "english" as another person removes nothing of the first
    expect(w.prefs.filter((p) => p.user_id === ID.u1)).toHaveLength(2);
  });
  it("memory refuses business records, credentials, sensitive facts and free text: nothing is stored and nothing is sent", async () => {
    for (const t of ["Remember that Sara's salary is AED 18,500", "Remember my password is Hunter2-Fictional", "Remember that the Harbour client always pays late", "Remember my passport number N4471923"]) {
      const r = await a.send({ companyId: ID.co1, text: t });
      expect(r.ok && (r.kind === "reply"), t).toBe(true);
    }
    expect(refusal(await a.memory({ op: "set", key: "note", value: "anything" })).code).toBe("invalid_input");
    expect(refusal(await a.memory({ op: "set", key: "tone", value: "Sara's salary is 18500" })).code).toBe("invalid_input");
    expect(w.prefs).toEqual([]);
    expect(simulatedProviderCalls).toHaveLength(0);
  });
  it("saving can be paused on its own (seeing and deleting still work); a database without the migration says so instead of failing", async () => {
    await a.memory({ op: "set", key: "tone", value: "formal" });
    const paused = make({ config: { paused: ["memory"] } });
    expect(refusal(await paused.memory({ op: "set", key: "english", value: "british" })).code).toBe("paused");
    expect(memoryOf(await paused.memory({ op: "delete", key: "tone" })).preferences).toEqual([]);
    w.memoryFn = "missing";
    expect(refusal(await a.memory({ op: "list" })).message).toMatch(/not set up/);
    chatOf(await a.send({ companyId: ID.co1, text: DRAFT })); // chat still works, with no preferences
  });
  it("a suggested correction is stored for review only: it changes no answer, is never sent to the provider, and protected details are refused", async () => {
    const before = matchGuidance("How do I log a follow-up?")[0]!.summary;
    replyOf(await a.suggestCorrection({ topicId: "sales-follow-ups", text: "The button is now called Plan next step." }));
    expect(w.suggestions).toEqual([{ user_id: ID.u1, topic_id: "sales-follow-ups", body: "The button is now called Plan next step.", status: "pending" }]);
    expect(matchGuidance("How do I log a follow-up?")[0]!.summary).toBe(before);
    expect(refusal(await a.suggestCorrection({ topicId: "sales-follow-ups", text: "Sara's salary is AED 18,500, please add it" })).code).toBe("protected_content");
    expect(w.suggestions).toHaveLength(1);
    expect(simulatedProviderCalls).toHaveLength(0);
  });
  it("the Map is the source of truth: the committed knowledge equals what the Map publishes, and a published Map update reaches JARVIS through the normal build (no retraining)", async () => {
    const script = path.join(ROOT, "scripts/build-jarvis-knowledge.mjs");
    expect(execFileSync("node", [script, "--check"], { encoding: "utf8" })).toMatch(/matches the Map/);
    const { parseGuidance, render } = (await import(/* @vite-ignore */ script)) as { parseGuidance: (md: string) => { id: string; status: string }[]; render: (t: unknown[]) => string };
    const md = (status: string) => `## A corrected topic\n- id: fictional-topic\n- area: sales\n- status: ${status}\n- keywords: fictional correction\n- links: Enquiries -> /sales/opportunities\n\nThe corrected, approved wording.\n\n1. Open Enquiries.\n`;
    expect(render(parseGuidance(md("published")))).toContain("The corrected, approved wording.");
    expect(render(parseGuidance(md("draft")))).not.toContain("The corrected, approved wording."); // not published = not shared knowledge
    expect(() => parseGuidance(md("published").replace("- id: fictional-topic\n", ""))).toThrow();
  });
});
