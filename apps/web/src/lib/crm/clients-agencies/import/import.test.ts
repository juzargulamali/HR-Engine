import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

import type { DirectoryRow } from "../directory";
import type { StaffPerson } from "../staff";
import { organisationsTable, summaryTable, buildExportWorkbook, OWNER_NAME_HEADER, type SummaryInputs } from "./export";
import { legacyWorkbook, makeWorkbook, parseBytes, planFor, TEMPLATE_ROW_HEADERS } from "./test-fixtures";
import { IMPORT_LIMITS, TEMPLATE_HEADERS, buildTemplateWorkbook, buildWorkbook, neutraliseCell, readImportSheet } from "./xlsx";
import { buildPlan, type PlanContext } from "./plan";
import { applyPlan, batchKeyFor } from "./apply";
import { PREVIEW_STALE_MESSAGE, runImport, type ImportDeps } from "./service";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER_CO = "22222222-2222-4222-8222-222222222222";
const FOUNDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SARA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sara: StaffPerson = { userId: SARA, name: "Sara Fixture", email: "sara@fixture.example", companyIds: [CO] };
const outsider: StaffPerson = { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Omar Elsewhere", email: "omar@fixture.example", companyIds: [OTHER_CO] };

let seq = 0;
function dirRow(name: string, o: { roles?: string[]; country?: string | null; website?: string | null; note?: string | null; lead?: string | null; exhibition?: string | null; owner?: string | null; contacts?: { name: string; email?: string | null }[]; vat?: string | null; licence?: string | null } = {}): DirectoryRow {
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  return {
    org: { id, name, roles: o.roles ?? [], country_code: o.country ?? null, website: o.website ?? null, website_domain: null, vat_trn: o.vat ?? null, trade_licence_no: o.licence ?? null, place: null, note: o.note ?? null, archived_at: null } as never,
    contacts: (o.contacts ?? []).map((c, i) => ({ id: `${id}-c${i}`, name: c.name, email: c.email ?? null, organisation_id: id, archived_at: null })) as never,
    profile: o.lead || o.exhibition || o.owner ? ({ organisation_id: id, company_id: CO, lead_source: o.lead ?? null, exhibition: o.exhibition ?? null, owner_id: o.owner ?? null } as never) : null,
    inquiryCount: 0, openCount: 0,
  };
}

const template = (rows: (string | null)[][]) => makeWorkbook([{ name: "Organisations", rows: [TEMPLATE_ROW_HEADERS, ...rows] }]);

describe("reading the three header sets", () => {
  it("template headers: several rows with one organisation name are ONE organisation with many contacts", async () => {
    const f = await parseBytes(await template([
      ["Fixture Events", "United Arab Emirates", "Agency", "fixture.example", "Ana One", "Producer", "ana@fixture.example", "+971500000001", "Referral", "Met in 2025", null],
      ["FIXTURE EVENTS.", null, null, null, "Ben Two", null, "ben@fixture.example", null, null, null, null],
      ["fixture events", null, null, null, "Cy Three", "Buyer", null, null, null, null, null],
    ]));
    expect(f.orgs).toHaveLength(1);
    expect(f.orgs[0]!.contacts.map((c) => c.name)).toEqual(["Ana One", "Ben Two", "Cy Three"]);
    expect(f.orgs[0]).toMatchObject({ roles: ["agency"], countryCode: "AE", leadSource: "referral", note: "Met in 2025" });
    expect(f.sourceRows).toBe(3);
    expect(f.duplicateRows).toHaveLength(2);
  });

  it("legacy headers (Client name, location, Type) map to name, country and type; the serial column is ignored; country is never an owner", async () => {
    const { bytes } = await legacyWorkbook({ serialHeader: "S.No" });
    const f = await parseBytes(bytes);
    expect(f.headerRow).toBe(2);
    expect(f.ignoredColumns).toEqual(["S.No"]);
    const o = f.orgs[0]!;
    expect(o).toMatchObject({ name: "Fixture Agency 001", roles: ["agency"], countryCode: "AE", ownerEmail: null });
    expect(f.orgs.every((x) => x.ownerEmail === null)).toBe(true);
  });

  it("Type mapping: Agency, Direct client, End client, Technology Company; an unknown type is flagged and the row kept", async () => {
    const f = await parseBytes(await makeWorkbook([{ name: "S", rows: [["Client name", "Type"], ["A One", "Agency"], ["B Two", "Direct client"], ["C Three", "End client"], ["D Four", "Technology Company"], ["E Five", "Reseller"]] }]));
    expect(f.orgs.map((o) => o.roles)).toEqual([["agency"], ["direct"], ["client"], ["technology"], []]);
    expect(f.orgs[4]!.flags[0]).toMatchObject({ kind: "type", row: 6 });
    expect(f.orgs).toHaveLength(5);
  });

  it("an unrecognised country does not block: it is flagged and kept in the notes", async () => {
    const f = await parseBytes(await template([["Fixture A", "Atlantis", null, null, null, null, null, null, null, "Hello", null]]));
    expect(f.orgs[0]!.countryCode).toBeNull();
    expect(f.orgs[0]!.note).toBe("Hello\nCountry as given: Atlantis");
    expect(f.orgs[0]!.flags[0]!.kind).toBe("country");
  });

  it("unnamed rows are skipped and counted; row errors carry the sheet row number; example rows are ignored", async () => {
    const f = await parseBytes(await template([
      ["EXAMPLE ONLY - Northwind (fictional)", null, null, null, null, null, null, null, null, null, null],
      [null, "UAE", "Agency", null, null, null, null, null, null, null, null],
      ["Fixture B", null, null, null, "Dee", null, "not-an-email", null, null, null, null],
      ["Fixture B", null, null, null, null, "Chair", null, null, null, null, null],
    ]));
    expect(f.exampleRows).toBe(1);
    expect(f.unnamedRows).toEqual([3]);
    expect(f.rowErrors.map((e) => e.row)).toEqual([4, 5]);
    expect(f.orgs[0]!.contacts).toHaveLength(0);
    expect(f.sourceRows).toBe(3);
  });

  it("differing values for one organisation inside the file keep the first value and say so", async () => {
    const f = await parseBytes(await template([["Fixture C", "UAE", null, null, null, null, null, null, null, null, null], ["Fixture C", "Qatar", null, null, null, null, null, null, null, null, null]]));
    expect(f.orgs[0]!.countryCode).toBe("AE");
    expect(f.orgs[0]!.flags[0]!.message).toMatch(/first value is used/);
  });
});

describe("the first-import fixture (fictional, same headers as the existing workbook)", () => {
  it("65 source rows, 1 unnamed, 6 duplicates collapsed, 58 candidates = 48 agencies + 4 direct clients + 6 technology companies", async () => {
    const { bytes, expected } = await legacyWorkbook();
    const f = await parseBytes(bytes);
    const p = planFor(f);
    expect(f.sourceRows).toBe(expected.source);
    expect(f.unnamedRows).toHaveLength(expected.unnamed);
    expect(f.duplicateRows).toHaveLength(expected.duplicates);
    expect(p.summary.candidates).toBe(expected.candidates);
    expect(p.summary.byType).toEqual({ agency: 48, direct: 4, client: 0, technology: 6, notRecorded: 0 });
    expect(p.summary).toMatchObject({ newOrganisations: 58, existingMatches: 0, ambiguous: 0, rowErrors: 0 });
  });
});

describe("preview classification against existing records", () => {
  it("new, existing (fills only empty fields), conflicts side by side and never applied, ambiguous never merged", async () => {
    const same = dirRow("Fixture Same", { roles: ["agency"], country: "AE" });
    const gaps = dirRow("Fixture Gaps");
    const clash = dirRow("Fixture Clash", { roles: ["agency"], country: "QA", website: "clash.example", lead: "website", exhibition: "Old Expo" });
    const twinA = dirRow("Fixture Twin");
    const twinB = dirRow("FIXTURE TWIN.");
    const siteOnly = dirRow("Different Name Ltd", { website: "shared.example" });
    const f = await parseBytes(await template([
      ["Brand New", "UAE", "Agency", null, null, null, null, null, null, null, null],
      ["Fixture Same", "United Arab Emirates", "Agency", null, null, null, null, null, null, null, null],
      ["Fixture Gaps", "Germany", "Technology Company", "gaps.example", null, null, null, null, "Gulfood 2026", null, null],
      ["Fixture Clash", "UAE", "Direct client", "other.example", null, null, null, null, "Referral / New Expo", null, null],
      ["Fixture Twin", null, null, null, null, null, null, null, null, null, null],
      ["Another Name", null, null, "https://www.shared.example/home", null, null, null, null, null, null, null],
    ]));
    const p = planFor(f, { directory: [same, gaps, clash, twinA, twinB, siteOnly] });
    const by = (n: string) => p.orgs.find((o) => o.name === n)!;
    expect(by("Brand New").kind).toBe("new");
    expect(by("Fixture Same")).toMatchObject({ kind: "existing", hasChanges: false });
    expect(by("Fixture Gaps")).toMatchObject({ kind: "existing", hasChanges: true, orgPatch: { country_code: "DE", roles: ["technology"], website: "gaps.example" }, profilePatch: { lead_source: "exhibition", exhibition: "Gulfood 2026" } });
    const c = by("Fixture Clash");
    expect(c.orgPatch).toEqual({});
    expect(c.profilePatch).toEqual({});
    expect(c.conflicts).toEqual(expect.arrayContaining([
      { field: "Country", existing: "Qatar", file: "United Arab Emirates" },
      { field: "Website", existing: "clash.example", file: "other.example" },
      { field: "Type", existing: "Agency", file: "Direct client" },
      { field: "Lead source", existing: "Website", file: "Referral" },
      { field: "Exhibition", existing: "Old Expo", file: "New Expo" },
    ]));
    expect(by("Fixture Twin")).toMatchObject({ kind: "ambiguous", hasChanges: false, orgPatch: {} });
    expect(by("Another Name").kind).toBe("ambiguous"); // same website, different name: a person decides
    expect(p.summary).toMatchObject({ newOrganisations: 1, existingMatches: 3, existingWithFills: 1, existingNoChange: 2, ambiguous: 2, conflictOrganisations: 1, conflictFields: 5 });
  });

  it("contacts are added only when they do not exist by normalised e-mail or name", async () => {
    const o = dirRow("Fixture Contacts", { contacts: [{ name: "Ana One", email: "ANA@fixture.example" }, { name: "Ben Two" }] });
    const f = await parseBytes(await template([
      ["Fixture Contacts", null, null, null, "Someone Else", null, "ana@fixture.example", null, null, null, null],
      ["Fixture Contacts", null, null, null, "ben  two", null, "ben@fixture.example", null, null, null, null],
      ["Fixture Contacts", null, null, null, "Cy Three", null, "cy@fixture.example", null, null, null, null],
    ]));
    const p = planFor(f, { directory: [o] });
    expect(p.orgs[0]!.contactsToAdd.map((c) => c.name)).toEqual(["Cy Three"]);
    expect(p.orgs[0]!.contactsExisting).toBe(2);
  });
});

describe("account owner e-mail", () => {
  const rows = [["Fixture Owned", null, null, null, null, null, null, null, null, null, "sara@fixture.example"]];
  const plan = async (ctx: Parameters<typeof planFor>[1]) => planFor(await parseBytes(await template(rows)), { companyId: CO, ...ctx });

  it("an eligible colleague is resolved against the selected company", async () => {
    expect((await plan({ staff: [sara] })).orgs[0]).toMatchObject({ assignOwnerId: SARA, flags: [] });
  });
  it("unknown, other-company, ambiguous, hidden e-mails and a missing assign right are flagged and the account stays Unassigned", async () => {
    const flagged = async (ctx: Parameters<typeof planFor>[1]) => { const o = (await plan(ctx)).orgs[0]!; expect(o.assignOwnerId).toBeNull(); return o.flags[0]!.message; };
    expect(await flagged({ staff: [{ ...sara, email: "someone@else.example" }] })).toMatch(/could not be verified/);
    expect(await flagged({ staff: [{ ...outsider, email: "sara@fixture.example" }] })).toMatch(/no Sales access here/);
    expect(await flagged({ staff: [sara, { ...sara, userId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }] })).toMatch(/more than one colleague/);
    expect(await flagged({ staff: [{ ...sara, email: null }, { ...outsider, email: null }] })).toMatch(/does not show colleagues' e-mail/);
    expect(await flagged({ staff: [sara], canAssign: false })).toMatch(/only a founder/);
  });
  it("an existing account that already has a different owner is a conflict, not a change", async () => {
    const o = dirRow("Fixture Owned", { owner: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    const p = await plan({ staff: [sara], directory: [o] });
    expect(p.orgs[0]).toMatchObject({ assignOwnerId: null });
    expect(p.orgs[0]!.conflicts[0]).toMatchObject({ field: "Account owner", file: "Sara Fixture" });
  });
});

describe("upload limits and untrusted content", () => {
  it("accepts only .xlsx within the size and row limits", async () => {
    const ok = await template([["Fixture A", null, null, null, null, null, null, null, null, null, null]]);
    expect((await readImportSheet(ok, "a.csv")).ok).toBe(false);
    expect((await readImportSheet(ok, "a.xlsm")).ok).toBe(false);
    expect((await readImportSheet(new Uint8Array(0), "a.xlsx")).ok).toBe(false);
    expect((await readImportSheet(new Uint8Array(IMPORT_LIMITS.maxBytes + 1), "a.xlsx")).ok).toBe(false);
    expect((await readImportSheet(new TextEncoder().encode("not a zip at all, just text"), "a.xlsx")).ok).toBe(false);
    expect((await readImportSheet(ok, "a.XLSX")).ok).toBe(true);
  });
  it("refuses a workbook that contains a macro project", async () => {
    const ok = Buffer.from(await template([["Fixture A", null, null, null, null, null, null, null, null, null, null]]));
    const patched = Buffer.from(ok.toString("latin1").split("docProps/core.xml").join("xl/vbaProject.bin"), "latin1");
    const r = await readImportSheet(new Uint8Array(patched), "a.xlsx");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toMatch(/macros/);
  });
  it("refuses more than the row cap", async () => {
    const rows = Array.from({ length: IMPORT_LIMITS.maxRows + 1 }, (_, i) => [`Org ${i}`]);
    const read = await readImportSheet(await makeWorkbook([{ name: "S", rows: [["Organisation name"], ...rows] }]), "a.xlsx");
    if (!read.ok) throw new Error(read.error);
    const { parseRows } = await import("./parse");
    expect(parseRows(read.rows)).toMatchObject({ ok: false });
  });
  it("never runs formulas: a formula cell yields its stored text, and a text cell that looks like a formula stays text", async () => {
    const f = await parseBytes(await makeWorkbook([{ name: "S", rows: [["Organisation name", "Notes"], [{ formula: 'HYPERLINK("http://evil.example","x")', result: "stored text" }, "=1+1"]] }]));
    expect(f.orgs[0]!.name).toBe("stored text");
    expect(f.orgs[0]!.note).toBe("=1+1");
  });
  it("a workbook without a name column is refused with a plain message", async () => {
    const read = await readImportSheet(await makeWorkbook([{ name: "S", rows: [["Foo", "Bar"], ["1", "2"]] }]), "a.xlsx");
    if (!read.ok) throw new Error(read.error);
    const { parseRows } = await import("./parse");
    expect(parseRows(read.rows)).toMatchObject({ ok: false, error: expect.stringMatching(/Organisation name/) });
  });
});

// The database boundary: the import hands the whole batch to ONE function (crm_import_apply) and reads fingerprints with another. What those
// functions do (locks, fill-only writes, the stale check, the batch key) is proved against a real Postgres in
// packages/rls-tests/test/crm-import-safety.rls.test.ts; here we prove what the application sends, and how it reads each answer.
type Call = { fn: string; args: Record<string, unknown> };
function makeDb(answer: (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null } = () => ({ data: { status: "applied", created: 0, updated: 0, contacts_added: 0, owners_assigned: 0, untouched: 0, failed: [] }, error: null })) {
  const calls: Call[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "crm_import_fingerprints") return { data: Object.fromEntries((args.p_items as { key: string }[]).map((i) => [i.key, `fp-${i.key}`])), error: null };
    if (fn === "crm_import_apply") return answer(args);
    return { data: null, error: { message: `unexpected ${fn}` } };
  };
  return { calls, rpc };
}

function deps(db: ReturnType<typeof makeDb>, over: Partial<ImportDeps> = {}): ImportDeps {
  return {
    db: { rpc: db.rpc } as never,
    ctx: { grants: [{ companyId: CO, capabilities: ["assign_owner"] }], companies: [{ id: CO }] },
    loadDirectory: async () => [],
    loadStaff: async () => [sara],
    ...over,
  };
}
const SAMPLE = () => template([
  ["Fixture One", "UAE", "Agency", "one.example", "Ana One", "Producer", "ana@fixture.example", null, "Referral", null, "sara@fixture.example"],
  ["Fixture One", null, null, null, "Ben Two", null, "ben@fixture.example", null, null, null, null],
  ["Fixture Two", "Qatar", "Direct client", null, null, null, null, null, null, null, "nobody@fixture.example"],
]);
const req = (bytes: Uint8Array, mode: "preview" | "confirm", companyId = CO, fingerprints?: Record<string, string>) => ({ companyId, fileName: "f.xlsx", bytes, mode, ...(fingerprints ? { fingerprints } : {}) });
const FPS = { fixtureone: "fp-fixtureone", fixturetwo: "fp-fixturetwo" };
const writes = (db: ReturnType<typeof makeDb>) => db.calls.filter((c) => c.fn !== "crm_import_fingerprints");

describe("running the import end to end", () => {
  it("refuses the signed-out, refuses a company without a grant, and touches nothing", async () => {
    const db = makeDb();
    const loadDirectory = vi.fn(async () => []);
    const bytes = await SAMPLE();
    expect(await runImport(deps(db, { ctx: null, loadDirectory }), req(bytes, "confirm", CO, FPS))).toMatchObject({ ok: false, status: 401 });
    expect(await runImport(deps(db, { loadDirectory }), req(bytes, "confirm", OTHER_CO, FPS))).toMatchObject({ ok: false, status: 403 });
    expect(await runImport(deps(db, { ctx: { grants: [{ companyId: OTHER_CO, capabilities: ["founder"] }], companies: [{ id: CO }] }, loadDirectory }), req(bytes, "confirm", CO, FPS))).toMatchObject({ ok: false, status: 403 });
    expect(await runImport(deps(db, { ctx: { grants: [], companies: [], loadFailed: true }, loadDirectory }), req(bytes, "preview"))).toMatchObject({ ok: false, status: 503 });
    expect(loadDirectory).not.toHaveBeenCalled();
    expect(db.calls).toHaveLength(0);
  });

  it("a preview writes nothing (it only reads fingerprints); a failed read says it could not load and never imports", async () => {
    const db = makeDb();
    const bytes = await SAMPLE();
    const r = await runImport(deps(db), req(bytes, "preview"));
    expect(r).toMatchObject({ ok: true, mode: "preview", fingerprints: FPS, summary: { newOrganisations: 2, contactsToAdd: 2, ownersToAssign: 1 } });
    expect(db.calls.map((c) => c.fn)).toEqual(["crm_import_fingerprints"]);
    expect(db.calls[0]!.args).toMatchObject({ p_company: CO, p_items: [{ key: "fixtureone", name: "Fixture One", website: "one.example" }, { key: "fixturetwo", name: "Fixture Two", website: null }] });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = await runImport(deps(db, { loadDirectory: async () => { throw new Error("down"); } }), req(bytes, "confirm", CO, FPS));
    expect(bad).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/Could not/) });
    expect(writes(db)).toHaveLength(0);
  });

  it("a confirm without the preview's fingerprints is refused before anything is sent", async () => {
    const db = makeDb();
    expect(await runImport(deps(db), req(await SAMPLE(), "confirm"))).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/preview first/i) });
    expect(await runImport(deps(db), req(await SAMPLE(), "confirm", CO, {}))).toMatchObject({ ok: false, status: 400 });
    expect(db.calls).toHaveLength(0);
  });

  it("confirm is ONE call to the database function, carrying the company, a batch key, every row and the preview's fingerprints; no other write exists", async () => {
    const db = makeDb(() => ({ data: { status: "applied", created: 2, updated: 0, contacts_added: 2, owners_assigned: 1, untouched: 0, failed: [] }, error: null }));
    const r = await runImport(deps(db), req(await SAMPLE(), "confirm", CO, FPS));
    expect(r).toMatchObject({ ok: true, mode: "confirm", repeated: false, result: { created: 2, contactsAdded: 2, ownersAssigned: 1, failed: [] } });
    expect(db.calls.map((c) => c.fn)).toEqual(["crm_import_apply"]);
    const a = db.calls[0]!.args as { p_company: string; p_batch_key: string; p_items: Record<string, unknown>[] };
    expect(a.p_company).toBe(CO);
    expect(a.p_batch_key).toMatch(/^[0-9a-f]{64}$/);
    expect(a.p_items).toHaveLength(2);
    expect(a.p_items[0]).toMatchObject({
      key: "fixtureone", name: "Fixture One", roles: ["agency"], country_code: "AE", website: "one.example", lead_source: "referral", owner_id: SARA, fingerprint: "fp-fixtureone",
      contacts: [{ name: "Ana One", email: "ana@fixture.example" }, { name: "Ben Two", email: "ben@fixture.example" }],
    });
    expect(a.p_items[1]).toMatchObject({ key: "fixturetwo", roles: ["direct"], country_code: "QA", owner_id: null, fingerprint: "fp-fixturetwo" }); // unknown owner e-mail: no owner sent
    const flagged = r.ok && r.mode === "confirm" ? r.review.review.map((i) => i.name) : [];
    expect(flagged).toEqual(["Fixture Two"]); // reported as "owner could not be verified"
  });

  it("existing and ambiguous rows are sent too: the database, not the application, decides what is safe for each", async () => {
    const db = makeDb();
    const dir = [dirRow("Fixture One", { roles: ["direct"], country: "QA" }), dirRow("Fixture Twin"), dirRow("Fixture Twin.")];
    const bytes = await template([["Fixture One", "UAE", "Agency"], ["Fixture Twin", "UAE", "Agency"]]);
    await runImport(deps(db, { loadDirectory: async () => dir }), req(bytes, "confirm", CO, { fixtureone: "x", fixturetwin: "y" }));
    expect((db.calls[0]!.args.p_items as { name: string }[]).map((i) => i.name)).toEqual(["Fixture One", "Fixture Twin"]);
  });

  it("the batch key is the same for the same preview of the same file, and different when the file, the company or what was planned against differs", () => {
    const k = (co: string, hash: string, fp: Record<string, string>) => batchKeyFor(co, hash, fp);
    expect(k(CO, "h", { a: "1", b: "2" })).toBe(k(CO, "h", { b: "2", a: "1" }));
    expect(new Set([k(CO, "h", { a: "1" }), k(CO, "h2", { a: "1" }), k(OTHER_CO, "h", { a: "1" }), k(CO, "h", { a: "2" })]).size).toBe(4);
  });

  it("a stale preview applies nothing and says to run a fresh preview", async () => {
    const db = makeDb(() => ({ data: { status: "preview_stale", stale_count: 1, stale: ["fixtureone"] }, error: null }));
    const r = await runImport(deps(db), req(await SAMPLE(), "confirm", CO, FPS));
    expect(r).toMatchObject({ ok: false, status: 409, code: "preview_stale", error: PREVIEW_STALE_MESSAGE });
    expect(PREVIEW_STALE_MESSAGE).toMatch(/Nothing was imported\. Run a fresh preview/);
  });

  it("a repeated confirm shows the first result and says so; a refusal for one row is reported against that organisation", async () => {
    const repeated = makeDb(() => ({ data: { status: "applied", repeated: true, created: 2, updated: 0, contacts_added: 2, owners_assigned: 1, untouched: 0, failed: [] }, error: null }));
    expect(await runImport(deps(repeated), req(await SAMPLE(), "confirm", CO, FPS))).toMatchObject({ ok: true, repeated: true, result: { created: 2 } });
    const refused = makeDb(() => ({ data: { status: "applied", created: 1, updated: 0, contacts_added: 0, owners_assigned: 0, untouched: 0, failed: [{ key: "fixtureone", message: "Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it" }] }, error: null }));
    expect(await runImport(deps(refused), req(await SAMPLE(), "confirm", CO, FPS))).toMatchObject({ ok: true, result: { created: 1, failed: [{ name: "Fixture One", rows: [2, 3], message: expect.stringMatching(/Only the person who added/) }] } });
  });

  it("the database's own refusals reach the person in plain words and nothing is reported as imported", async () => {
    const denied = makeDb(() => ({ data: null, error: { message: "You do not have Sales access for this company" } }));
    expect(await runImport(deps(denied), req(await SAMPLE(), "confirm", CO, FPS))).toMatchObject({ ok: false, status: 503, error: "You do not have Sales access for this company" });
    const odd = makeDb(() => ({ data: null, error: null }));
    expect(await runImport(deps(odd), req(await SAMPLE(), "confirm", CO, FPS))).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/did not return a result/) });
  });

  it("rejects a non-xlsx upload with a 400 and no reads", async () => {
    const db = makeDb();
    const loadDirectory = vi.fn(async () => []);
    expect(await runImport(deps(db, { loadDirectory }), { companyId: CO, fileName: "f.csv", bytes: new Uint8Array([1, 2, 3]), mode: "preview" })).toMatchObject({ ok: false, status: 400 });
    expect(loadDirectory).not.toHaveBeenCalled();
  });
});

describe("template and export", () => {
  const read = async (bytes: Uint8Array) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes as never); return wb; };

  it("the template has the agreed headers, an Instructions sheet and clearly fictional example rows that import as nothing", async () => {
    const wb = await read(await buildTemplateWorkbook());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Organisations", "Instructions"]);
    expect((wb.getWorksheet("Organisations")!.getRow(1).values as string[]).slice(1)).toEqual([...TEMPLATE_HEADERS]);
    const f = await parseBytes(await buildTemplateWorkbook());
    expect(f.orgs).toHaveLength(0);
    expect(f.exampleRows).toBe(3);
  });

  it("neutralises formula injection in exported text", async () => {
    expect(["=1+1", "+1", "-1", "@SUM(A1)", "\tx", "plain"].map((v) => neutraliseCell(v))).toEqual(["'=1+1", "'+1", "'-1", "'@SUM(A1)", "'\tx", "plain"]);
    const bytes = await buildExportWorkbook([dirRow("=cmd|' /C calc'!A0", { note: "@evil", contacts: [{ name: "+Bob" }] })], [], summaryInputs([]));
    const ws = (await read(bytes)).getWorksheet("Organisations")!;
    expect(ws.getCell("A2").value).toBe("'=cmd|' /C calc'!A0");
    expect(ws.getCell("J2").value).toBe("'@evil");
    expect(ws.getCell("E2").value).toBe("'+Bob");
  });

  const summaryInputs = (opps: SummaryInputs["opportunities"]): SummaryInputs => ({ companyId: CO, opportunities: opps, proposals: [], zoho: [], activities: [], projects: { status: "ok", data: [] } });
  const opp = (id: string, agency: string | null, client: string | null, stage: SummaryInputs["opportunities"][number]["stage"] = "new") => ({ id, company_id: CO, reference: id, title: id, stage, agency_org_id: agency, client_org_id: client, owner_id: FOUNDER, currency: "AED", value: 1, closed_at: null, created_at: "2026-01-01T00:00:00Z" });

  it("sheet 1: one row per contact, organisations without contacts get one row, e-mail only for a person who may see e-mails", () => {
    const a = dirRow("Fixture A", { roles: ["agency", "technology"], country: "AE", lead: "referral", exhibition: "Sample Expo", owner: SARA, contacts: [{ name: "Ana", email: "ana@fixture.example" }, { name: "Ben" }] });
    const b = dirRow("Fixture B");
    const founderView = organisationsTable([a, b], [sara]);
    expect(founderView.headers.slice(0, 13)).toEqual([...TEMPLATE_HEADERS]);
    expect(founderView.rows).toHaveLength(3);
    expect(founderView.rows[0]!.slice(0, 4)).toEqual(["Fixture A", "United Arab Emirates", "Agency, Technology company", ""]);
    expect(founderView.rows[0]![10]).toBe("sara@fixture.example");
    const salesView = organisationsTable([a], [{ ...sara, email: null }]);
    expect(salesView.headers[10]).toBe("Account owner name (not imported)");
    expect(salesView.rows[0]![10]).toBe("Sara Fixture");
    expect(JSON.stringify(salesView.rows)).not.toContain("sara@fixture.example");
  });

  it("summary counts use the account page's definitions", () => {
    const a = dirRow("Agency A");
    const c = dirRow("Client C");
    const t = summaryTable([a, c], summaryInputs([opp("1", a.org.id, c.org.id, "won"), opp("2", null, c.org.id), opp("3", a.org.id, a.org.id, "lost")]));
    const cells = (name: string) => t.rows.find((r) => r[0] === name)!;
    expect(cells("Agency A").slice(1, 9)).toEqual([2, 0, 1, 1, 1, 0, 1, 0]); // inquiries, open, won, lost, direct, through agency, as agency, quotes
    expect(cells("Client C").slice(1, 9)).toEqual([2, 1, 1, 0, 1, 1, 0, 0]);
  });

  it("round trip: export then import preview is all 'existing match, nothing to change', and the Summary sheet is ignored", async () => {
    const a = dirRow("Fixture A", { roles: ["agency"], country: "AE", website: "a.example", note: "Hello", lead: "exhibition", exhibition: "Sample Expo", owner: SARA, contacts: [{ name: "Ana", email: "ana@fixture.example" }, { name: "Ben" }] });
    const b = dirRow("Fixture B", { roles: ["direct", "technology"], lead: "referral", exhibition: "Side Expo" });
    const dir = [a, b];
    const bytes = await buildExportWorkbook(dir, [sara], summaryInputs([opp("1", a.org.id, b.org.id)]));
    const f = await parseBytes(bytes);
    const p = planFor(f, { directory: dir, staff: [sara], companyId: CO });
    expect(p.summary).toMatchObject({ candidates: 2, newOrganisations: 0, existingMatches: 2, existingNoChange: 2, existingWithFills: 0, conflictFields: 0, ambiguous: 0, contactsToAdd: 0, ownersToAssign: 0, rowErrors: 0 });
    expect(p.orgs.every((o) => o.flags.length === 0)).toBe(true);

    // Edit every number on the Summary sheet and add rows to it: the import must not see any of it.
    const wb = await read(bytes);
    const sum = wb.getWorksheet("Summary (read-only)")!;
    sum.getRow(2).getCell(2).value = 999;
    sum.addRow(["Ghost Organisation", 5, 5]);
    const edited = new Uint8Array(await wb.xlsx.writeBuffer());
    const p2 = planFor(await parseBytes(edited), { directory: dir, staff: [sara], companyId: CO });
    expect(p2.summary).toEqual(p.summary);
    expect(p2.orgs.some((o) => o.name === "Ghost Organisation")).toBe(false);
  });

  it("round trip keeps characters that need neutralising (a phone starting with +)", async () => {
    const a = dirRow("Fixture P", { contacts: [{ name: "Pat" }] });
    (a.contacts[0] as { phone?: string }).phone = "+971 50 000 0000";
    const f = await parseBytes(await buildExportWorkbook([a], [], summaryInputs([])));
    expect(f.orgs[0]!.contacts[0]!.phone).toBe("+971 50 000 0000");
  });

  it("template headers appear in the same order in the export", () => {
    expect(organisationsTable([], []).headers.slice(0, 10)).toEqual(TEMPLATE_HEADERS.slice(0, 10));
  });
});

describe("client identifiers (VAT registration number / TRN, trade licence number)", () => {
  const H = [...TEMPLATE_ROW_HEADERS, "VAT registration number / TRN", "Trade licence number"];
  const ctx = (directory: DirectoryRow[]): PlanContext => ({ companyId: CO, directory, staff: [sara], canAssignOwner: true } as never);

  it("reads both columns as text and keeps leading zeros, trims and keeps the first value", async () => {
    const f = await parseBytes(await makeWorkbook([{ name: "Organisations", rows: [H,
      ["Fixture Ids", null, null, null, null, null, null, null, null, null, null, "  0001234  ", "0098"],
      ["Fixture Ids", null, null, null, null, null, null, null, null, null, null, "999", null]] }]));
    expect(f.orgs[0]).toMatchObject({ vatTrn: "0001234", tradeLicence: "0098" });
    expect(f.orgs[0]!.flags.some((x) => /VAT registration number/.test(x.message))).toBe(true);
  });

  it("a legacy upload without the columns still works and fills nothing", async () => {
    const f = await parseBytes(await template([["Fixture Legacy", "United Arab Emirates", "Agency", null, null, null, null, null, null, null, null]]));
    expect(f.orgs[0]).toMatchObject({ vatTrn: null, tradeLicence: null });
    const plan = buildPlan(f, ctx([]));
    expect(plan.orgs[0]!.incoming).toMatchObject({ vat_trn: null, trade_licence_no: null });
  });

  it("fills empty identifiers; a different existing value is a conflict and is never part of the patch", async () => {
    const f = await parseBytes(await makeWorkbook([{ name: "Organisations", rows: [H,
      ["Fixture Has Both", null, null, null, null, null, null, null, null, null, null, "0000777", "0000888"],
      ["Fixture Has Empty", null, null, null, null, null, null, null, null, null, null, "0000555", "0000666"],
      ["Fixture Same", null, null, null, null, null, null, null, null, null, null, "0000111", null]] }]));
    const plan = buildPlan(f, ctx([dirRow("Fixture Has Both", { vat: "123", licence: "0000888" }), dirRow("Fixture Has Empty"), dirRow("Fixture Same", { vat: "0000111" })]));
    const [both, empty, same] = plan.orgs;
    expect(both!.conflicts).toEqual([{ field: "VAT registration number / TRN", existing: "123", file: "0000777" }]);
    expect(both!.orgPatch).toEqual({});
    expect(empty!.orgPatch).toEqual({ vat_trn: "0000555", trade_licence_no: "0000666" });
    expect(empty!.conflicts).toEqual([]);
    expect(same!.hasChanges).toBe(false);
  });

  it("the items sent to the database carry the identifiers exactly as typed", async () => {
    const f = await parseBytes(await makeWorkbook([{ name: "Organisations", rows: [H, ["Fixture New", null, null, null, null, null, null, null, null, null, null, "007", "0042"]] }]));
    const rpc = vi.fn().mockResolvedValue({ data: { status: "applied", created: 1 }, error: null });
    await applyPlan({ rpc } as never, buildPlan(f, ctx([])), CO, { [f.orgs[0]!.key]: "x" }, "batch");
    const items = rpc.mock.calls[0]![1].p_items as { vat_trn: string; trade_licence_no: string }[];
    expect(items[0]).toMatchObject({ vat_trn: "007", trade_licence_no: "0042" });
  });

  it("export carries both columns after the owner column, and an export of a record with identifiers re-imports as 'nothing to change'", async () => {
    const rows = [dirRow("Fixture Round Trip", { vat: "00123", licence: "0045" })];
    const table = organisationsTable(rows, []);
    expect(table.headers.slice(0, TEMPLATE_HEADERS.length)).toEqual([...TEMPLATE_HEADERS].map((h) => (h === "Account owner work email" ? OWNER_NAME_HEADER : h)));
    expect(table.rows[0]!.slice(11, 13)).toEqual(["00123", "0045"]);
    const bytes = await buildWorkbook([table]);
    const parsed = await parseBytes(bytes);
    expect(parsed.orgs[0]).toMatchObject({ vatTrn: "00123", tradeLicence: "0045" });
    const plan = buildPlan(parsed, ctx(rows));
    expect(plan.orgs[0]!.hasChanges).toBe(false);
    expect(plan.orgs[0]!.conflicts).toEqual([]);
  });

  it("the template has the two columns, text formatted", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildTemplateWorkbook()) as never);
    const ws = wb.getWorksheet("Organisations")!;
    expect([ws.getCell("L1").value, ws.getCell("M1").value]).toEqual(["VAT registration number / TRN", "Trade licence number"]);
    expect(ws.getColumn(12).numFmt).toBe("@");
  });
});
