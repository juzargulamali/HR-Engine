import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { gateProvider } from "@/lib/jarvis/outbound";
import { createSimulatedProvider, simulatedBehaviour, simulatedProviderCalls } from "@/lib/jarvis/provider/simulated";
import { APP_AI_RULES, JARVIS_RULES, ruleFor } from "@/lib/jarvis/rulebook";
import { buildOutbound, evidenceItems, OUTBOUND_BUDGET, payloadHash, reviewSummary, selectedItems, type CloseoutSelection, type EvidenceSnapshot } from "./evidence";
import { fixtureSnapshot, ID } from "./fixture";
import { blockingFlags, factsOnlyDraft, flagsFor, keyFacts, REPORT_SECTIONS, reviewFlags, toSourceRefs, validateDraft, validateEdits } from "./report";
import { generateCloseoutDraft, type CloseoutReportRow } from "./service";

/** A stand-in for the database: the evidence function, the report table and the save function, with the same rules the real ones have (proved in packages/rls-tests). */
function fakeDb(state: { snapshot: EvidenceSnapshot; reports: CloseoutReportRow[]; manager?: boolean; evidenceFails?: boolean; calls: string[] }) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.calls.push(name);
      if (state.manager === false) return { data: null, error: { code: name === "proj_closeout_evidence" ? "P0002" : "42501", message: "Only the Project Manager" } };
      if (name === "proj_closeout_evidence") return state.evidenceFails ? { data: null, error: { code: "XX000", message: "boom" } } : { data: { ...state.snapshot, taken_at: new Date().toISOString() }, error: null };
      if (name === "proj_closeout_save_draft") {
        const { taken_at: _a, ...given } = args.p_snapshot as EvidenceSnapshot; const { taken_at: _b, ...now } = state.snapshot;
        if (JSON.stringify(given) !== JSON.stringify(now)) return { data: null, error: { code: "40001", message: "The project's records changed" } };
        let draft = state.reports.find((r) => r.status === "draft");
        if (!draft) { draft = { id: `draft-${state.reports.length + 1}`, project_id: ID.project, version_no: state.reports.length + 1, status: "draft", version: 0 } as CloseoutReportRow; state.reports.push(draft); }
        Object.assign(draft, { snapshot: args.p_snapshot, selection: args.p_selection, payload_hash: args.p_payload_hash, generation: args.p_generation, provider_kind: args.p_provider_kind, sections: args.p_sections, source_refs: args.p_source_refs, version: draft.version + 1 });
        return { data: { id: draft.id, version_no: draft.version_no, version: draft.version }, error: null };
      }
      return { data: null, error: { code: "42883", message: "does not exist" } };
    },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: state.reports, error: null }) }) }) }),
  } as never;
}
const reviewed = (s: EvidenceSnapshot, selection: CloseoutSelection | null) => payloadHash(buildOutbound(evidenceItems(s), selection).text);
const defaults = (s: EvidenceSnapshot): CloseoutSelection => ({ include: evidenceItems(s).filter((x) => x.optional?.defaultOn).map((x) => x.optional!.key) });
const everything = (s: EvidenceSnapshot): CloseoutSelection => ({ include: evidenceItems(s).filter((x) => x.optional).map((x) => x.optional!.key) });

beforeEach(() => { simulatedProviderCalls.length = 0; simulatedBehaviour.closeout = "ok"; });

describe("closeout evidence: what may leave, decided by an allowlist", () => {
  const s = fixtureSnapshot();
  const items = evidenceItems(s);

  it("gives every line a stable reference and a source record, the same every time", () => {
    expect(items.map((x) => x.ref)).toEqual(items.map((_, i) => `S${i + 1}`));
    expect(evidenceItems(fixtureSnapshot())).toEqual(items);
    expect(items.every((x) => x.source.label && x.source.type)).toBe(true);
    expect(items.find((x) => x.text.includes("Add a second kiosk"))!.source).toMatchObject({ type: "scope_change", id: ID.change });
    expect(items.find((x) => x.text.startsWith("Client feedback 1, received"))!.source).toMatchObject({ type: "feedback", id: ID.feedback });
    expect(items.find((x) => x.text.includes("LED panel P2.6"))!.source).toMatchObject({ type: "equipment_line", id: ID.reqLine });
  });

  it("says the sign-off is NOT RECORDED and keeps equipment that is still out visible, as separate facts", () => {
    const text = buildOutbound(items, null).text;
    expect(text).toContain("Client sign-off: NOT RECORDED");
    expect(text).toContain("Completion: NOT RECORDED");
    expect(text).toContain("sent 4, returned 1, still out 3, due back 2027-03-08");
    expect(text).toContain("Equipment still out, all requests together: 3 units");
    // a completed project whose equipment is still out: both facts are stated
    const done = fixtureSnapshot({ project: { ...s.project, status: "completed" }, completion: { id: ID.completion, completed_at: "2027-03-06T12:00:00+00:00", completed_by: "Pat Manager", evidence_type: "signed_handover", confirmed_on: "2027-03-06", has_reference: true, has_file: false, resolutions: [], note_text: "Handed over on site" } });
    const doneText = buildOutbound(evidenceItems(done), null).text;
    expect(doneText).toContain("Client sign-off: recorded as a signed handover, confirmed 2027-03-06");
    expect(doneText).toContain("still out 3");
    expect(keyFacts(done).find((f) => f.label === "Equipment")).toMatchObject({ value: "3 units still out, due back 2027-03-08", attention: true });
    expect(keyFacts(s).find((f) => f.label === "Client sign-off")).toMatchObject({ value: "Not recorded", attention: true });
  });

  it("keeps the original agreement distinct from the final scope", () => {
    const text = buildOutbound(items, null).text;
    expect(text).toContain("ORIGINAL scope, as agreed at handover (as written): LED welcome wall 6 x 4 m");
    expect(text).toContain("FINAL agreed scope (as written): LED welcome wall 6 x 4 m plus a second kiosk");
    expect(text).toContain("The agreed scope now differs from the scope on the accepted handover. Approved scope changes: 1.");
  });

  it("free text is optional: the client's words, our response and notes go only when selected; the PM can remove the rest", () => {
    const byDefault = buildOutbound(items, null).text;
    expect(byDefault).not.toContain("Please make the welcome loop brighter");
    expect(byDefault).not.toContain("Brightness raised");
    expect(byDefault).not.toContain("rehearsal the evening before");
    expect(byDefault).toContain("Agreed with the client on the 12 Feb call");          // a decision's recorded reason is on by default
    expect(byDefault).toContain("Client feedback 1, received 2027-03-02");              // the fact that feedback was recorded always goes
    const none = buildOutbound(items, { include: [] }).text;
    for (const t of ["Agreed with the client", "LED welcome wall 6 x 4 m", "One extra install day"]) expect(none).not.toContain(t);
    const all = buildOutbound(items, everything(s)).text;
    expect(all).toContain('the client\'s request (exact recorded text): "Please make the welcome loop brighter"');
    expect(all).toContain("Brightness raised and confirmed on site");
    expect(selectedItems(items, { include: ["not-a-key"] }).some((x) => x.optional)).toBe(false);
  });

  it("the review summary shows the categories, the team names, each optional text and what is missing", () => {
    const r = reviewSummary(items, null, fixtureSnapshot({ missing: ["Equipment: the equipment records could not be read"] }));
    expect(r.categories.map((c) => c.category)).toEqual(["project", "scope", "team", "decisions", "feedback", "delivery", "handover", "equipment", "open_items"]);
    expect(r.teamNames).toEqual(["Pat Manager", "Casey Content", "Eli Engineer", "Pri Programmer"]);
    expect(r.optional.find((o) => o.key === `feedback-request:${ID.feedback}`)).toMatchObject({ selected: false, label: "Feedback 1: the client's words" });
    expect(r.optional.find((o) => o.key === "scope-original")).toMatchObject({ selected: true });
    expect(r.missing).toEqual(["Equipment: the equipment records could not be read"]);
    expect(r.hash).toBe(reviewed(s, null));
    expect(reviewed(s, { include: [] })).not.toBe(r.hash);
  });

  it("a source that could not be read is stated in the evidence, never left out as if there were nothing", () => {
    const text = buildOutbound(evidenceItems(fixtureSnapshot({ equipment: null, missing: ["Equipment: the equipment records could not be read"] })), null).text;
    expect(text).toContain("NOT AVAILABLE: Equipment: the equipment records could not be read.");
    expect(keyFacts(fixtureSnapshot({ equipment: null })).find((f) => f.label === "Equipment")!.value).toMatch(/Not known/);
  });

  it("withholds a line with protected details, a sharing restriction or an amount of money, and never sends it even if selected", () => {
    const risky = fixtureSnapshot({
      scope: { ...s.scope, current_text: "Second kiosk added for AED 18,000 extra" },
      feedback: [{ ...s.feedback[0]!, request_text: "INTERNAL USE ONLY: client unhappy", response_text: "Casey was on sick leave, so Pri covered" }],
      decisions: [{ ...s.decisions[0]!, reason: "Margin stays at 40% after the change" }],
    });
    const it2 = evidenceItems(risky);
    const out = buildOutbound(it2, everything(risky));
    for (const t of ["18,000", "INTERNAL USE ONLY", "sick leave", "40%"]) expect(out.text).not.toContain(t);
    expect(it2.filter((x) => x.withheld).map((x) => x.withheld).sort()).toEqual(["money", "money", "protected", "restricted"]);
    expect(reviewSummary(it2, everything(risky), risky).withheld.map((w) => w.why)).toContain("mentions an amount of money");
    // nothing in the ordinary fixture is withheld: the fixed wording itself never trips the policy
    expect(items.filter((x) => x.withheld)).toEqual([]);
  });

  it("is an allowlist: a field added to the snapshot is not sent, and nothing commercial or private is", () => {
    const planted = { ...fixtureSnapshot(), budget: { total: 250000 }, chat: ["PRIVATE-CHAT"], project: { ...s.project, value: 99999, contact_email: "jane@example.com" } } as unknown as EvidenceSnapshot;
    (planted.team[0] as unknown as Record<string, unknown>).salary = 30000;
    (planted.team[0] as unknown as Record<string, unknown>).phone = "+971500000000";
    (planted.handover!.technologies[0] as unknown as Record<string, unknown>).unit_price = 4500;
    const text = buildOutbound(evidenceItems(planted), everything(planted)).text;
    for (const banned of ["250000", "PRIVATE-CHAT", "99999", "jane@example.com", "30000", "+971", "4500", ID.pm, ID.project]) expect(text).not.toContain(banned);
  });

  it("is bounded: a very large project is cut to the budget, optional text first, and what was cut is reported", () => {
    const big = fixtureSnapshot({ plan: Array.from({ length: 60 }, (_, i) => ({ ...s.plan[0]!, id: `p${i}`, key: `D${String(i + 1).padStart(3, "0")}`, title: `Deliverable ${i} ${"x".repeat(120)}`, lines: Array.from({ length: 4 }, (_, k) => ({ ...s.plan[0]!.lines[1]!, id: `l${i}-${k}`, key: `L${i}-${k}`, description: `Line ${"y".repeat(150)}` })) })) });
    const out = buildOutbound(evidenceItems(big), everything(big));
    expect(out.text.length).toBeLessThanOrEqual(OUTBOUND_BUDGET);
    expect(out.dropped.length).toBeGreaterThan(0);
    expect(out.text).toContain("Client sign-off: NOT RECORDED");                         // the facts that matter most are never the ones cut
    expect(out.text).toContain("Equipment still out, all requests together");
    expect(reviewSummary(evidenceItems(big), everything(big), big).dropped.length).toBe(out.dropped.length);
  });
});

describe("closeout report: the writer's answer is checked against the same evidence", () => {
  const s = fixtureSnapshot();
  const sent = buildOutbound(evidenceItems(s), everything(s)).sent;
  const sources = new Map(sent.map((x) => [x.ref, x.text]));
  const refOf = (needle: string) => sent.find((x) => x.text.includes(needle))!.ref;

  it("keeps only the report's own fields, drops references that were not sent, and orders the sections", () => {
    const v = validateDraft({ sections: [{ id: "team", paragraphs: [{ text: "Eli Engineer was the accountable owner of D001.", refs: [refOf("Eli Engineer: Member"), "S9999"], extra: 1 }] }, { id: "nonsense", paragraphs: [{ text: "x", refs: [] }] }], execute: true }, sent, s)!;
    expect(v.sections.map((x) => x.id)).toEqual(REPORT_SECTIONS.map((x) => x.id));
    const p = v.sections.find((x) => x.id === "team")!.paragraphs[0]!;
    expect(p).toEqual({ text: "Eli Engineer was the accountable owner of D001.", refs: [refOf("Eli Engineer: Member")], flags: [] });
    expect(JSON.stringify(v)).not.toMatch(/execute|nonsense|extra/);
    expect(validateDraft({ nothing: true }, sent, s)).toBeNull();
    expect(validateDraft({ sections: [] }, sent, s)).toBeNull();
  });

  it("marks a sign-off nobody recorded, equipment said to be back, an unsourced figure, an invented quotation and a paragraph with no source", () => {
    const f = (text: string, refs: string[] = [refOf("Client sign-off")]) => flagsFor(text, refs, "handover", sources, s);
    expect(f("The client signed off the installation.")).toContain("signoff_unrecorded");
    expect(f("The work was accepted by the client on site.")).toContain("signoff_unrecorded");
    expect(f("Client sign-off is not recorded.")).toEqual([]);
    expect(f("No client sign-off has been recorded for this project.")).toEqual([]);
    expect(f("All equipment was returned to the warehouse.", [refOf("still out 3")])).toContain("equipment_out");
    expect(f("3 of the 4 LED panels sent are still out and due back 2027-03-08.", [refOf("still out 3")])).toEqual([]);
    expect(f("The wall was handed over on 2027-03-09.")).toContain("unverified_figure");
    expect(f('The client said "this is the best stand we have ever had".', [refOf("Client feedback 1, received")])).toContain("unverified_quote");
    expect(f('The client asked: "Please make the welcome loop brighter".', [refOf("the client's request")])).toEqual([]);
    expect(f("Everything went well.", [])).toEqual(["no_source"]);
    expect(flagsFor("Book the rigging earlier next time.", [], "lessons", sources, s, ["suggestion"])).toEqual(["suggestion"]);
    // once a sign-off IS recorded the same sentence is fine
    const signed = fixtureSnapshot({ completion: { id: ID.completion, completed_at: "2027-03-06T12:00:00+00:00", completed_by: "Pat Manager", evidence_type: "signed_handover", confirmed_on: "2027-03-06", has_reference: true, has_file: false, resolutions: [], note_text: null } });
    expect(flagsFor("The client signed off the installation.", [refOf("Project UAE-P")], "handover", sources, signed)).toEqual([]);
    // an internal note is not a client sign-off
    expect(flagsFor("The client signed off the installation.", [refOf("Project UAE-P")], "handover", sources, { ...signed, completion: { ...signed.completion!, evidence_type: "internal_note" } })).toContain("signoff_unrecorded");
  });

  it("a paragraph with protected details in the answer is left out", () => {
    const v = validateDraft({ sections: [{ id: "team", paragraphs: [{ text: "Her salary is AED 18,500 per month.", refs: [] }, { text: "Casey Content finished the welcome loop.", refs: [refOf("Casey Content: Member")] }] }] }, sent, s)!;
    expect(v.withheld).toBe(1);
    expect(v.sections.find((x) => x.id === "team")!.paragraphs.map((p) => p.text)).toEqual(["Casey Content finished the welcome loop."]);
  });

  it("the facts-only draft is the evidence itself, every line with its own reference", () => {
    const d = factsOnlyDraft(sent);
    expect(d.map((x) => x.id)).toEqual(REPORT_SECTIONS.map((x) => x.id));
    expect(d.flatMap((x) => x.paragraphs).every((p) => p.refs.length === 1 && sources.get(p.refs[0]!) === p.text && p.flags.length === 0)).toBe(true);
    expect(d.find((x) => x.id === "lessons")!.paragraphs).toEqual([]);
    expect(d.find((x) => x.id === "handover")!.paragraphs.map((p) => p.text).join("\n")).toContain("Client sign-off: NOT RECORDED");
  });

  it("the Project Manager's edits are checked the same way, and a rewritten lesson stops being a suggestion", () => {
    const refs = toSourceRefs(sent);
    const before = validateDraft({ sections: [{ id: "lessons", paragraphs: [{ text: "Agree the return date early.", refs: [] }] }, { id: "handover", paragraphs: [{ text: "Client sign-off is not recorded.", refs: [refOf("Client sign-off")] }] }] }, sent, s)!.sections;
    expect(before.find((x) => x.id === "lessons")!.paragraphs[0]!.flags).toEqual(["suggestion"]);
    const edited = validateEdits([{ id: "lessons", paragraphs: [{ text: "Agree the return date early.", refs: [] }, { text: "My own lesson.", refs: [] }] }, { id: "handover", paragraphs: [{ text: "The client signed off on site.", refs: [refOf("Client sign-off"), "S9999"] }, { text: "   ", refs: [] }] }], refs, s, before)!;
    expect(edited.find((x) => x.id === "lessons")!.paragraphs.map((p) => p.flags)).toEqual([["suggestion"], []]);
    expect(edited.find((x) => x.id === "handover")!.paragraphs).toEqual([{ text: "The client signed off on site.", refs: [refOf("Client sign-off")], flags: ["signoff_unrecorded"] }]);
    expect(blockingFlags(edited)).toEqual(["signoff_unrecorded"]);
    expect(reviewFlags(edited)).toEqual([]);
    expect(validateEdits("nope", refs, s, before)).toBeNull();
  });
});

describe("closeout generation: one bounded call through the outbound gate, with a simulated provider", () => {
  const s = fixtureSnapshot();
  const run = (state: Parameters<typeof fakeDb>[0], over: Partial<{ selection: CloseoutSelection; reviewedHash: string; mode: "ai" | "facts"; provider: ReturnType<typeof createSimulatedProvider> | null }> = {}) => {
    const selection = over.selection ?? defaults(state.snapshot);
    return generateCloseoutDraft(fakeDb(state), { projectId: ID.project, selection, reviewedHash: over.reviewedHash ?? reviewed(state.snapshot, selection), mode: over.mode ?? "ai" }, { provider: over.provider === undefined ? createSimulatedProvider() : over.provider });
  };
  const fresh = () => ({ snapshot: fixtureSnapshot(), reports: [] as CloseoutReportRow[], calls: [] as string[] });

  it("the rule is not a JARVIS capability, and the gate refuses the evidence under any other rule", async () => {
    expect(ruleFor("projects.closeout.draft")).toMatchObject({ outbound: { provider: true, sources: ["project_closeout_evidence"] } });
    expect(JARVIS_RULES.some((r) => r.id.startsWith("projects.") || r.outbound.sources.includes("project_closeout_evidence"))).toBe(false);
    expect(APP_AI_RULES.map((r) => r.id)).toEqual(["projects.closeout.draft"]);
    const sent: unknown[] = [];
    const raw = { kind: "simulated" as const, structured: async (r: unknown) => { sent.push(r); return {}; } };
    const req = { task: "closeout_report", instructions: "i", input: "<request>\nx\n</request>", inputTag: null, recordText: "[S1] (Project) x", jsonSchema: {}, maxOutputTokens: 10, timeoutMs: 10 };
    await expect(gateProvider(raw, "jarvis.sales.summary.run")!.structured({ ...req, sources: ["project_closeout_evidence"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "jarvis.sales.chat.reply")!.structured({ ...req, sources: ["user_text", "project_closeout_evidence"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "projects.closeout.draft")!.structured({ ...req, sources: ["sales_record_text"] })).rejects.toMatchObject({ code: "unavailable" });
    await expect(gateProvider(raw, "projects.closeout.draft")!.structured({ ...req, sources: ["project_closeout_evidence"], recordText: "" })).rejects.toMatchObject({ code: "unavailable" });
    expect(sent).toEqual([]);
  });

  it("sends exactly the reviewed lines once, and the draft traces the decision, the feedback, the delivery and the handover to their records", async () => {
    const state = fresh();
    const selection = everything(state.snapshot);
    const r = await run(state, { selection });
    expect(r).toMatchObject({ ok: true, reused: false, mode: "ai" });
    expect(simulatedProviderCalls).toHaveLength(1);
    const req = simulatedProviderCalls[0]!;
    expect(req.sources).toEqual(["project_closeout_evidence"]);
    expect(req.maxOutputTokens).toBeLessThanOrEqual(4000);
    expect(req.timeoutMs).toBeLessThanOrEqual(60_000);
    const expected = buildOutbound(evidenceItems(state.snapshot), selection).text;
    expect(req.input).toBe(`<request>\nWrite the internal closeout report from the evidence lines below.\n</request>\n<enginious_os_data>\n${expected}\n</enginious_os_data>`);
    expect(req.input.length).toBeLessThanOrEqual(24_000);
    for (const banned of [ID.pm, ID.project, ID.feedback, "@", "AED", "budget", "salary"]) expect(req.input).not.toContain(banned);
    const draft = state.reports[0]!;
    expect(draft).toMatchObject({ status: "draft", generation: "generated", provider_kind: "simulated", payload_hash: reviewed(state.snapshot, selection) });
    const refs = new Map(draft.source_refs.map((x) => [x.ref, x]));
    const cited = (id: string) => draft.sections.find((x) => x.id === id)!.paragraphs.flatMap((p) => p.refs.map((ref) => refs.get(ref)!));
    expect(cited("decisions").map((x) => [x.source_type, x.source_id])).toContainEqual(["scope_change", ID.change]);
    expect(cited("feedback").map((x) => [x.source_type, x.source_id])).toContainEqual(["feedback", ID.feedback]);
    expect(cited("handover").map((x) => x.source_type)).toEqual(expect.arrayContaining(["project", "equipment_line"]));
    expect(draft.sections.flatMap((x) => x.paragraphs).every((p) => p.refs.every((ref) => refs.has(ref)))).toBe(true);
    expect(draft.sections.find((x) => x.id === "handover")!.paragraphs.map((p) => p.text).join(" ")).toContain("Client sign-off: NOT RECORDED");
    expect(blockingFlags(draft.sections)).toEqual([]);
    expect(state.calls.filter((c) => !c.startsWith("proj_closeout_"))).toEqual([]);      // it called nothing but the report's own functions
  });

  it("content the PM removed is not in the request", async () => {
    const state = fresh();
    await run(state, { selection: { include: [] } });
    const input = simulatedProviderCalls[0]!.input;
    for (const t of ["Please make the welcome loop brighter", "Brightness raised", "Agreed with the client", "rehearsal", "LED welcome wall 6 x 4 m"]) expect(input).not.toContain(t);
    expect(input).toContain("Client feedback 1, received 2027-03-02");
  });

  it("unsupported claims from the provider are marked, and stop approval; hostile keys do nothing", async () => {
    simulatedBehaviour.closeout = "unsupported";
    const state = fresh();
    expect((await run(state)).ok).toBe(true);
    const draft = state.reports[0]!;
    const flagged = draft.sections.flatMap((x) => x.paragraphs).filter((p) => p.flags.length > 0 && !p.flags.includes("suggestion"));
    expect(flagged.find((p) => p.text.includes("signed off"))!.flags.sort()).toEqual(["equipment_out", "signoff_unrecorded", "unverified_figure"]);
    expect(flagged.find((p) => p.text.includes("best stand"))!.flags).toContain("unverified_quote");
    expect(flagged.find((p) => p.text.includes("dedication"))).toMatchObject({ refs: [], flags: ["no_source"] });
    expect(blockingFlags(draft.sections).length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(draft)).not.toMatch(/markComplete|sendToClient|client@example\.com|"execute"/);
    expect(state.calls.filter((c) => !c.startsWith("proj_closeout_"))).toEqual([]);
  });

  it("a retry with the same reviewed content does not send it again or make a second version", async () => {
    const state = fresh();
    const first = await run(state);
    const again = await run(state);
    expect(again).toMatchObject({ ok: true, reused: true, reportId: (first as { reportId: string }).reportId });
    expect(simulatedProviderCalls).toHaveLength(1);
    expect(state.reports).toHaveLength(1);
    await run(state, { selection: { include: [] } });                                  // different content: one more call, still one draft
    expect(simulatedProviderCalls).toHaveLength(2);
    expect(state.reports).toHaveLength(1);
  });

  it("a provider failure, a timeout or an unusable answer saves nothing, and the retry works", async () => {
    for (const [provider, code] of [
      [{ kind: "simulated" as const, structured: async () => { throw new (await import("@/lib/jarvis/provider")).JarvisProviderError("timeout"); } }, "provider_failed"],
      [{ kind: "simulated" as const, structured: async () => { throw new (await import("@/lib/jarvis/provider")).JarvisProviderError("http", 500); } }, "provider_failed"],
    ] as const) {
      const state = fresh();
      const r = await run(state, { provider: provider as never });
      expect(r).toMatchObject({ ok: false, code });
      expect((r as { message: string }).message).toMatch(/Nothing was saved\. You can try again\./);
      expect(state.reports).toEqual([]);
      expect((await run(state)).ok).toBe(true);
      expect(state.reports).toHaveLength(1);
    }
    simulatedBehaviour.closeout = "malformed";
    const state = fresh();
    expect(await run(state)).toMatchObject({ ok: false, code: "unusable" });
    expect(state.reports).toEqual([]);
  });

  it("if the records changed since the review, or while writing, nothing is sent or saved", async () => {
    const state = fresh();
    const stale = reviewed(fixtureSnapshot({ tasks: { ...s.tasks, done: 2, open: 0 } }), defaults(s));
    expect(await run(state, { reviewedHash: stale })).toMatchObject({ ok: false, code: "changed" });
    expect(simulatedProviderCalls).toHaveLength(0);
    const moving = fresh();
    const provider = { kind: "simulated" as const, structured: async (req: never) => { moving.snapshot = fixtureSnapshot({ tasks: { ...s.tasks, done: 2, open: 0 } }); return createSimulatedProvider().structured(req); } };
    expect(await run(moving, { provider: provider as never })).toMatchObject({ ok: false, code: "changed" });
    expect(moving.reports).toEqual([]);
  });

  it("someone who does not manage the project gets nothing, and a failed read is said, not shown as empty", async () => {
    expect(await run({ ...fresh(), manager: false })).toMatchObject({ ok: false, code: "denied" });
    expect(await run({ ...fresh(), evidenceFails: true })).toMatchObject({ ok: false, code: "not_loaded" });
    expect(simulatedProviderCalls).toHaveLength(0);
  });

  it("with no provider, the AI draft is unavailable and says so; the facts-only draft sends nothing", async () => {
    const state = fresh();
    expect(await run(state, { provider: null })).toMatchObject({ ok: false, code: "unavailable" });
    const r = await generateCloseoutDraft(fakeDb(state), { projectId: ID.project, selection: defaults(s), reviewedHash: reviewed(s, defaults(s)), mode: "ai" }, { env: { JARVIS_DISABLED: "1" } });
    expect(r).toMatchObject({ ok: false, code: "unavailable" });
    expect(await run(state, { mode: "facts" })).toMatchObject({ ok: true, mode: "facts" });
    expect(simulatedProviderCalls).toHaveLength(0);
    expect(state.reports[0]).toMatchObject({ generation: "none", provider_kind: null });
  });

  it("evidence that fails the data policy at the gate is not sent", async () => {
    // A line that slipped past the per-line screen would still be stopped by the gate: prove it with the gate directly.
    const sent: unknown[] = [];
    const raw = { kind: "simulated" as const, structured: async (r: unknown) => { sent.push(r); return {}; } };
    await expect(gateProvider(raw, "projects.closeout.draft")!.structured({ sources: ["project_closeout_evidence"], task: "closeout_report", instructions: "i", input: "<request>\nx\n</request>", inputTag: null, recordText: "[S1] (Team) Her salary is AED 18,500 per month.", jsonSchema: {}, maxOutputTokens: 10, timeoutMs: 10 })).rejects.toMatchObject({ code: "protected_content" });
    expect(sent).toEqual([]);
  });
});
