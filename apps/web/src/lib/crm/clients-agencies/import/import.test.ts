import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));

import type { DirectoryRow } from "../directory";
import type { StaffPerson } from "../staff";
import { organisationsTable, summaryTable, buildExportWorkbook, type SummaryInputs } from "./export";
import { legacyWorkbook, makeWorkbook, parseBytes, planFor, TEMPLATE_ROW_HEADERS } from "./test-fixtures";
import { IMPORT_LIMITS, TEMPLATE_HEADERS, buildTemplateWorkbook, neutraliseCell, readImportSheet } from "./xlsx";
import { runImport, type ImportDeps } from "./service";

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER_CO = "22222222-2222-4222-8222-222222222222";
const FOUNDER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SARA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const sara: StaffPerson = { userId: SARA, name: "Sara Fixture", email: "sara@fixture.example", companyIds: [CO] };
const outsider: StaffPerson = { userId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Omar Elsewhere", email: "omar@fixture.example", companyIds: [OTHER_CO] };

let seq = 0;
function dirRow(name: string, o: { roles?: string[]; country?: string | null; website?: string | null; note?: string | null; lead?: string | null; exhibition?: string | null; owner?: string | null; contacts?: { name: string; email?: string | null }[] } = {}): DirectoryRow {
  const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  return {
    org: { id, name, roles: o.roles ?? [], country_code: o.country ?? null, website: o.website ?? null, website_domain: null, place: null, note: o.note ?? null, archived_at: null } as never,
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

// A small in-memory stand-in for the part 1 database functions, used to run the whole import twice and concurrently.
function makeStore(opts: { refuseUpdates?: boolean } = {}) {
  const orgs: DirectoryRow[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    await new Promise((r) => setTimeout(r, 1));
    const find = (id: unknown) => orgs.find((o) => o.org.id === id)!;
    switch (fn) {
      case "crm_create_organisation_profile": {
        const r = dirRow(String(args.p_name), { roles: args.p_roles as string[], country: args.p_country_code as string | null, website: args.p_website as string | null, note: args.p_note as string | null, lead: args.p_lead_source as string | null, exhibition: args.p_exhibition as string | null, owner: args.p_owner_id as string | null });
        r.profile ??= { organisation_id: r.org.id, company_id: args.p_company_id, lead_source: null, exhibition: null, owner_id: null } as never;
        r.contacts = (args.p_contacts as { name: string; email: string | null }[]).map((c, i) => ({ id: `${r.org.id}-n${i}`, name: c.name, email: c.email, organisation_id: r.org.id, archived_at: null })) as never;
        orgs.push(r);
        return { data: r.org.id, error: null };
      }
      case "crm_update_organisation": {
        if (opts.refuseUpdates) return { data: null, error: { message: "Only the person who added this organisation, a founder, or the owner of an opportunity it is on can change it" } };
        Object.assign(find(args.p_org).org, args.p_patch as object);
        return { data: null, error: null };
      }
      case "crm_save_account_profile": {
        const o = find(args.p_org);
        o.profile = { ...(o.profile ?? { organisation_id: o.org.id, company_id: args.p_company, lead_source: null, exhibition: null, owner_id: null }), ...(args.p_patch as object) } as never;
        return { data: null, error: null };
      }
      case "crm_assign_account_owner": {
        const o = find(args.p_org);
        o.profile = { ...(o.profile ?? { organisation_id: o.org.id, company_id: args.p_company, lead_source: null, exhibition: null }), owner_id: args.p_new_owner } as never;
        return { data: null, error: null };
      }
      case "crm_create_contact": {
        const o = find(args.p_organisation_id);
        o.contacts = [...o.contacts, { id: `${o.org.id}-x${o.contacts.length}`, name: args.p_name, email: args.p_email, organisation_id: o.org.id, archived_at: null } as never];
        return { data: "contact", error: null };
      }
      default: return { data: null, error: { message: `unexpected ${fn}` } };
    }
  };
  return { orgs, calls, rpc };
}

function deps(store: ReturnType<typeof makeStore>, over: Partial<ImportDeps> = {}): ImportDeps {
  return {
    db: { rpc: store.rpc } as never,
    ctx: { grants: [{ companyId: CO, capabilities: ["assign_owner"] }], companies: [{ id: CO }] },
    loadDirectory: async () => store.orgs.map((o) => ({ ...o })),
    loadStaff: async () => [sara],
    ...over,
  };
}
const SAMPLE = () => template([
  ["Fixture One", "UAE", "Agency", "one.example", "Ana One", "Producer", "ana@fixture.example", null, "Referral", null, "sara@fixture.example"],
  ["Fixture One", null, null, null, "Ben Two", null, "ben@fixture.example", null, null, null, null],
  ["Fixture Two", "Qatar", "Direct client", null, null, null, null, null, null, null, "nobody@fixture.example"],
]);
const req = (bytes: Uint8Array, mode: "preview" | "confirm", companyId = CO) => ({ companyId, fileName: "f.xlsx", bytes, mode });

describe("running the import end to end", () => {
  it("refuses the signed-out, refuses a company without a grant, and touches nothing", async () => {
    const store = makeStore();
    const loadDirectory = vi.fn(async () => []);
    const bytes = await SAMPLE();
    expect(await runImport(deps(store, { ctx: null, loadDirectory }), req(bytes, "confirm"))).toMatchObject({ ok: false, status: 401 });
    expect(await runImport(deps(store, { loadDirectory }), req(bytes, "confirm", OTHER_CO))).toMatchObject({ ok: false, status: 403 });
    expect(await runImport(deps(store, { ctx: { grants: [{ companyId: OTHER_CO, capabilities: ["founder"] }], companies: [{ id: CO }] }, loadDirectory }), req(bytes, "confirm"))).toMatchObject({ ok: false, status: 403 });
    expect(await runImport(deps(store, { ctx: { grants: [], companies: [], loadFailed: true }, loadDirectory }), req(bytes, "preview"))).toMatchObject({ ok: false, status: 503 });
    expect(loadDirectory).not.toHaveBeenCalled();
    expect(store.calls).toHaveLength(0);
  });

  it("a preview writes nothing; a failed read says it could not load and never imports", async () => {
    const store = makeStore();
    const bytes = await SAMPLE();
    const r = await runImport(deps(store), req(bytes, "preview"));
    expect(r).toMatchObject({ ok: true, mode: "preview", summary: { newOrganisations: 2, contactsToAdd: 2, ownersToAssign: 1 } });
    expect(store.calls).toHaveLength(0);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const bad = await runImport(deps(store, { loadDirectory: async () => { throw new Error("down"); } }), req(bytes, "confirm"));
    expect(bad).toMatchObject({ ok: false, status: 503, error: expect.stringMatching(/Could not/) });
    expect(store.calls).toHaveLength(0);
  });

  it("confirm creates the organisations once, only through the CRM functions, only for the selected company, and never creates a user", async () => {
    const store = makeStore();
    const r = await runImport(deps(store), req(await SAMPLE(), "confirm"));
    expect(r).toMatchObject({ ok: true, mode: "confirm", result: { created: 2, contactsAdded: 2, ownersAssigned: 1, failed: [] } });
    expect(store.orgs.map((o) => o.org.name).sort()).toEqual(["Fixture One", "Fixture Two"]);
    expect(store.orgs.find((o) => o.org.name === "Fixture One")!.profile?.owner_id).toBe(SARA);
    expect(store.orgs.find((o) => o.org.name === "Fixture Two")!.profile?.owner_id ?? null).toBeNull(); // unknown owner e-mail: left Unassigned
    expect(new Set(store.calls.map((c) => c.fn))).toEqual(new Set(["crm_create_organisation_profile"]));
    expect(store.calls.every((c) => c.args.p_company_id === CO)).toBe(true);
    const two = r.ok && r.mode === "confirm" ? r.review.review.map((i) => i.name) : [];
    expect(two).toEqual(["Fixture Two"]); // reported as "owner could not be verified"
  });

  it("re-importing the same file is safe: all existing, nothing to change, nothing created", async () => {
    const store = makeStore();
    const bytes = await SAMPLE();
    await runImport(deps(store), req(bytes, "confirm"));
    const before = store.calls.length;
    const pv = await runImport(deps(store), req(bytes, "preview"));
    expect(pv).toMatchObject({ ok: true, summary: { newOrganisations: 0, existingMatches: 2, existingNoChange: 2, existingWithFills: 0, conflictFields: 0, contactsToAdd: 0, safeActions: 0 } });
    const again = await runImport(deps(store), req(bytes, "confirm"));
    expect(again).toMatchObject({ ok: true, result: { created: 0, updated: 0, contactsAdded: 0, untouched: 2 } });
    expect(store.calls.length).toBe(before);
    expect(store.orgs).toHaveLength(2);
  });

  it("a double-click on Confirm cannot create anything twice", async () => {
    const store = makeStore();
    const bytes = await SAMPLE();
    const [a, b] = await Promise.all([runImport(deps(store), req(bytes, "confirm"), "u1"), runImport(deps(store), req(bytes, "confirm"), "u1")]);
    expect(store.orgs).toHaveLength(2);
    const created = [a, b].map((x) => (x.ok && x.mode === "confirm" ? x.result.created : -1));
    expect(created.sort()).toEqual([0, 2]);
  });

  it("existing records: empty fields filled, new contacts added, conflicts left exactly as recorded", async () => {
    const store = makeStore();
    store.orgs.push(dirRow("Fixture One", { roles: ["direct"], country: "QA", contacts: [{ name: "Ana One", email: "ana@fixture.example" }] }));
    const r = await runImport(deps(store), req(await SAMPLE(), "confirm"));
    expect(r).toMatchObject({ ok: true, result: { created: 1, updated: 1, contactsAdded: 1 } }); // Ben added to One; Fixture Two created
    const one = store.orgs.find((o) => o.org.name === "Fixture One")!;
    expect(one.org).toMatchObject({ roles: ["direct"], country_code: "QA", website: "one.example" });
    expect(one.profile).toMatchObject({ lead_source: "referral", owner_id: SARA });
    expect(one.contacts.map((c) => c.name)).toEqual(["Ana One", "Ben Two"]);
    expect(r.ok && r.mode === "confirm" ? r.totals.conflicts : 0).toBe(1);
    expect(store.calls.some((c) => c.fn === "crm_update_organisation" && "country_code" in (c.args.p_patch as object))).toBe(false);
  });

  it("a refusal by the database is reported against that organisation and the rest still go ahead", async () => {
    const store = makeStore({ refuseUpdates: true });
    store.orgs.push(dirRow("Fixture One"));
    const r = await runImport(deps(store), req(await SAMPLE(), "confirm"));
    expect(r).toMatchObject({ ok: true, result: { created: 1, failed: [{ name: "Fixture One", message: expect.stringMatching(/Only the person who added/) }] } });
  });

  it("rejects a non-xlsx upload with a 400 and no reads", async () => {
    const store = makeStore();
    expect(await runImport(deps(store), { companyId: CO, fileName: "f.csv", bytes: new Uint8Array([1, 2, 3]), mode: "preview" })).toMatchObject({ ok: false, status: 400 });
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
  const opp = (id: string, agency: string | null, client: string | null, stage = "new") => ({ id, company_id: CO, reference: id, title: id, stage, agency_org_id: agency, client_org_id: client, owner_id: null, currency: "AED", value: 1, closed_at: null, created_at: "2026-01-01T00:00:00Z" });

  it("sheet 1: one row per contact, organisations without contacts get one row, e-mail only for a person who may see e-mails", () => {
    const a = dirRow("Fixture A", { roles: ["agency", "technology"], country: "AE", lead: "referral", exhibition: "Sample Expo", owner: SARA, contacts: [{ name: "Ana", email: "ana@fixture.example" }, { name: "Ben" }] });
    const b = dirRow("Fixture B");
    const founderView = organisationsTable([a, b], [sara]);
    expect(founderView.headers.slice(0, 11)).toEqual([...TEMPLATE_HEADERS]);
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
