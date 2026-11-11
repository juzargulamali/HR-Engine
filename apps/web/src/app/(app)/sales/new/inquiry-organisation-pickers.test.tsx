/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const created = vi.fn();
const loadInquiryOrganisations = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ checkDuplicates: vi.fn(), createOpportunity: (...a: unknown[]) => created(...a), updateOpportunity: vi.fn(), loadInquiryOrganisations: () => loadInquiryOrganisations() }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));
const saveEventEdition = vi.fn();
vi.mock("@/lib/actions/events", () => ({ saveEventEdition: (...a: unknown[]) => saveEventEdition(...a) }));

import { EventEditionPicker, OrganisationPicker, type EnquiryOrganisation } from "./new-enquiry-form";
import { EditDetailsDialog, type EditableOpportunity } from "../opportunities/[id]/edit-details";

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };

afterEach(() => { cleanup(); created.mockReset(); loadInquiryOrganisations.mockReset(); saveEventEdition.mockReset(); });

const orgs: EnquiryOrganisation[] = [
  { id: "both", name: "Fictional Both Roles Co", kind: "agency", roles: ["agency", "client"], place: null },
  { id: "agency", name: "Fictional Agency Only", kind: "agency", roles: ["agency"], place: null },
  { id: "client", name: "Fictional Client Only", kind: "client", roles: ["client"], place: null },
  { id: "direct", name: "Fictional Direct Co", kind: "direct", roles: ["direct"], place: null },
  { id: "tech", name: "Fictional Tech Only", kind: "client", roles: ["technology"], place: null },
  { id: "legacy", name: "Fictional Legacy Client", kind: "client", roles: [], place: null },
];
/** The names offered right now under a field (type first: nothing is chosen by typing). */
const type = (label: string, text: string) => { const el = screen.getByRole("combobox", { name: new RegExp(label) }); fireEvent.focus(el); fireEvent.change(el, { target: { value: text } }); return el; };
const offered = (label: string, text = "") => { type(label, text); return within(screen.getByRole("listbox", { name: new RegExp(`^${label}.*matches`) })).getAllByRole("option").map((o) => (o.textContent ?? "").replace(/\s+/g, " ").trim()); };
const choose = (label: string, text: string, name: RegExp) => { type(label, text); fireEvent.click(within(screen.getByRole("listbox", { name: new RegExp(`^${label}.*matches`) })).getByRole("option", { name })); };
const posted = (name: string) => (document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null)?.value;

function Pickers({ onChange }: { onChange: (v: { agency: string; client: string }) => void }) {
  const [agency, setAgency] = useState("");
  const [client, setClient] = useState("");
  onChange({ agency, client });
  return (
    <>
      <OrganisationPicker id="a" name="agencyOrgId" label="Agency" hint="" value={agency} onChange={setAgency} organisations={orgs} field="agency" onAdd={() => undefined} />
      <OrganisationPicker id="c" name="clientOrgId" label="End client" hint="" value={client} onChange={setClient} organisations={orgs} field="client" onAdd={() => undefined} />
    </>
  );
}

describe("create: ONE search-as-you-type field per party, honouring organisation roles", () => {
  it("one organisation with roles agency and client can be chosen in BOTH fields; the list of organisations does not grow", () => {
    let chosen = { agency: "", client: "" };
    render(<Pickers onChange={(v) => { chosen = v; }} />);
    choose("Agency", "both", /Fictional Both Roles Co/);
    choose("End client", "both", /Fictional Both Roles Co/);
    expect(chosen).toEqual({ agency: "both", client: "both" });
    expect(posted("agencyOrgId")).toBe("both");
    expect(posted("clientOrgId")).toBe("both");
    expect(orgs).toHaveLength(6);   // choosing creates nothing: the same record is the agency and the client
  });
  it("typing alone selects nothing", () => {
    let chosen = { agency: "x", client: "x" };
    render(<Pickers onChange={(v) => { chosen = v; }} />);
    type("Agency", "Fictional Agency Only");
    expect(chosen.agency).toBe("");
    expect(posted("agencyOrgId")).toBe("");
  });
  it("an organisation without the role is not offered; legacy records read as their kind", () => {
    render(<Pickers onChange={() => undefined} />);
    expect(offered("Agency").map((t) => t.replace(/ .*Roles.*/, ""))).toHaveLength(2);
    expect(offered("Agency").join("|")).toMatch(/Both Roles Co.*\|Fictional Agency Only/);
    const client = offered("End client").join("|");
    for (const name of ["Fictional Both Roles Co", "Fictional Client Only", "Fictional Direct Co", "Fictional Legacy Client"]) expect(client).toContain(name);
    expect(client).not.toContain("Fictional Tech Only");
    expect(client).not.toContain("Fictional Agency Only");
  });
  it("shows the country and website under a name so similar names can be told apart", () => {
    const two: EnquiryOrganisation[] = [
      { id: "u", name: "Fictional Aurora", kind: "agency", roles: ["agency"], place: null, country: "AE", website: "https://www.aurora.example/about" },
      { id: "k", name: "Fictional Aurora", kind: "agency", roles: ["agency"], place: null, country: "SA", website: null },
    ];
    render(<OrganisationPicker id="a" name="agencyOrgId" label="Agency" hint="" value="" onChange={() => undefined} organisations={two} field="agency" onAdd={() => undefined} />);
    const rows = offered("Agency", "aurora");
    expect(rows[0]).toContain("United Arab Emirates");
    expect(rows[0]).toContain("aurora.example");
    expect(rows[0]).not.toContain("https://");
    expect(rows[1]).toContain("Saudi Arabia");
  });
  it("a miss says what is recorded as an agency and where to add it", () => {
    render(<Pickers onChange={() => undefined} />);
    type("Agency", "zzz");
    expect(screen.getByText(/Nothing recorded as an agency matches/)).toBeTruthy();
  });
});

describe("the Event / Exhibition field", () => {
  const editions = [
    { id: "g27", label: "GITEX Global · 2027 · Dubai", detail: "Fictional Hall · 2027-10-11", archived: false },
    { id: "g26", label: "GITEX Global · 2026 · Dubai", detail: "Fictional Hall · 2026-10-12", archived: false },
    { id: "old", label: "Retired Show · 2024", detail: "2024-02-01", archived: true },
  ];
  it("selects one specific edition from the shared list; typing alone links nothing; clearing unlinks", () => {
    function Host() { const [x, setX] = useState(""); return <><EventEditionPicker id="e" value={x} onChange={setX} editions={editions} /><output data-testid="chosen">{x}</output></>; }
    render(<Host />);
    const chosen = () => screen.getByTestId("chosen").textContent;
    type("Event", "gitex 2027");
    expect(chosen()).toBe("");
    fireEvent.click(screen.getByRole("option", { name: /GITEX Global · 2027 · Dubai/ }));
    expect(chosen()).toBe("g27");
    expect(posted("eventEditionId")).toBe("g27");
    fireEvent.click(screen.getByRole("button", { name: /Clear Event/ }));
    expect(chosen()).toBe("");
    expect(posted("eventEditionId")).toBe("");
  });
  it("says so (and offers no empty field) when the events could not be loaded", () => {
    render(<EventEditionPicker id="e" value="" onChange={() => undefined} editions={[]} loadError />);
    expect(screen.getByText(/Could not load the events/)).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});

describe("edit: Edit details offers the same fields", () => {
  const data: EditableOpportunity = {
    id: "opp", version: 3, agencyOrgId: "agency", clientOrgId: "client", eventEditionId: "g26", title: "T", brief: null, currency: "AED", value: null, budgetNote: null, paymentTerms: null,
    eventStart: null, eventEnd: null, installStart: null, location: null, scope: null, exclusions: null, waitingOn: null, technologies: [], risks: [],
  };
  const editions = [{ id: "g26", label: "GITEX Global · 2026 · Dubai", detail: "", archived: false }, { id: "g27", label: "GITEX Global · 2027 · Dubai", detail: "", archived: false }];
  const ok = { ok: true, organisations: orgs, editions, events: [], editionsFailed: false };
  const open = (over: Partial<EditableOpportunity> = {}) => render(<EditDetailsDialog open onClose={() => undefined} data={{ ...data, ...over }} mode="full" availabilityWillNeedRecheck={false} />);
  const ready = async () => waitFor(() => expect((screen.getByRole("combobox", { name: /^Agency/ }) as HTMLInputElement).disabled).toBe(false));
  const formOf = () => screen.getByRole("combobox", { name: /^Agency/ }).closest("form") as HTMLFormElement;

  it("the multi-role organisation can be chosen as the agency and as the end client; one that lacks the role is absent", async () => {
    loadInquiryOrganisations.mockResolvedValue(ok);
    open();
    await ready();
    expect(offered("Agency").join("|")).not.toContain("Fictional Tech Only");
    choose("Agency", "both", /Fictional Both Roles Co/);
    choose("End client", "both", /Fictional Both Roles Co/);
    const form = new FormData(formOf());
    expect([form.get("agency_org_id"), form.get("client_org_id")]).toEqual(["both", "both"]);
  });
  it("saving other details does not post the agency, end client or event link (nothing is rewritten or logged as changed)", async () => {
    loadInquiryOrganisations.mockResolvedValue(ok);
    open();
    await ready();
    const names = Array.from(new FormData(formOf()).keys());
    for (const n of ["agency_org_id", "client_org_id", "event_edition_id"]) expect(names).not.toContain(n);
  });
  it("shows the current event, and changing or clearing it posts exactly that", async () => {
    loadInquiryOrganisations.mockResolvedValue(ok);
    open();
    await ready();
    expect((screen.getByRole("combobox", { name: /Event/ }) as HTMLInputElement).value).toBe("GITEX Global · 2026 · Dubai");
    choose("Event", "2027", /GITEX Global · 2027/);
    expect(new FormData(formOf()).get("event_edition_id")).toBe("g27");
    fireEvent.click(screen.getByRole("button", { name: /Clear Event/ }));
    expect(new FormData(formOf()).get("event_edition_id")).toBe("");
  });
  it("an enquiry with no event link starts empty, and setting one posts it", async () => {
    loadInquiryOrganisations.mockResolvedValue(ok);
    open({ eventEditionId: null });
    await ready();
    expect((screen.getByRole("combobox", { name: /Event/ }) as HTMLInputElement).value).toBe("");
    expect(Array.from(new FormData(formOf()).keys())).not.toContain("event_edition_id");
    choose("Event", "2026", /GITEX Global · 2026/);
    expect(new FormData(formOf()).get("event_edition_id")).toBe("g26");
  });
  it("a failed load says so and offers no empty pickers", async () => {
    loadInquiryOrganisations.mockResolvedValue({ ok: false, error: "Could not load the organisations. Close this and try again." });
    open();
    expect(await screen.findByText(/Could not load the organisations/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /^Agency/ })).toBeNull();
  });
  it("events that fail to load do not stop the agency and end-client fields", async () => {
    loadInquiryOrganisations.mockResolvedValue({ ...ok, editions: [], editionsFailed: true });
    open();
    await ready();
    expect(screen.getByText(/Could not load the events/)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: /Event/ })).toBeNull();
  });
  it("an older inquiry whose organisation lacks the role still shows it as the current choice", async () => {
    loadInquiryOrganisations.mockResolvedValue(ok);
    open({ agencyOrgId: "client" });
    await ready();
    await waitFor(() => expect((screen.getByRole("combobox", { name: /^Agency/ }) as HTMLInputElement).value).toBe("Fictional Client Only"));
  });

  describe("show dates and the event edition", () => {
    const dated = [
      { id: "g26", label: "GITEX Global · 2026 · Dubai", detail: "", archived: false, start: "2026-10-12", end: "2026-10-16" },
      { id: "g27", label: "GITEX Global · 2027 · Dubai", detail: "", archived: false, start: "2027-10-11", end: "2027-10-15" },
    ];
    const withDates = { ok: true, organisations: orgs, editions: dated, events: [{ id: "ev-gitex", name: "GITEX Global", editions: 2 }], editionsFailed: false };
    const val = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
    it("opening the form never changes the saved dates, even when they differ from the linked edition; it says so and offers the edition's dates", async () => {
      loadInquiryOrganisations.mockResolvedValue(withDates);
      open({ eventEditionId: "g26", eventStart: "2026-10-11", eventEnd: "2026-10-18" });
      await ready();
      expect([val("Show starts"), val("Show ends")]).toEqual(["2026-10-11", "2026-10-18"]);
      expect(screen.getByText(/These dates differ from the selected edition/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Use edition dates" }));
      expect([val("Show starts"), val("Show ends")]).toEqual(["2026-10-12", "2026-10-16"]);
      const form = new FormData(formOf());
      expect([form.get("event_start"), form.get("event_end")]).toEqual(["2026-10-12", "2026-10-16"]);
    });
    it("choosing another edition keeps the saved date and fills only the empty one", async () => {
      loadInquiryOrganisations.mockResolvedValue(withDates);
      open({ eventEditionId: "g26", eventStart: "2026-10-11", eventEnd: null });
      await ready();
      choose("Event", "2027", /GITEX Global · 2027/);
      expect([val("Show starts"), val("Show ends")]).toEqual(["2026-10-11", "2027-10-15"]);
      expect(new FormData(formOf()).get("event_edition_id")).toBe("g27");
    });
    it("Create event or edition keeps every unsaved field, selects the new edition and fills the empty show dates; Cancel changes nothing", async () => {
      loadInquiryOrganisations.mockResolvedValue(withDates);
      saveEventEdition.mockResolvedValue({ error: null, id: "ev-new", editionId: "ed-new" });
      open({ eventStart: null, eventEnd: null });
      await ready();
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fictional edited title" } });
      fireEvent.change(screen.getByLabelText("Location"), { target: { value: "Fictional Hall 3" } });
      type("Event", "Fictional Spring Show");
      fireEvent.click(screen.getByRole("button", { name: "Create event or edition" }));
      expect((screen.getByLabelText("Event name") as HTMLInputElement).value).toBe("Fictional Spring Show");
      fireEvent.click(screen.getAllByRole("button", { name: "Cancel" }).at(-1)!);            // the event form's Cancel
      expect(screen.queryByLabelText("Event name")).toBeNull();
      expect([val("Title"), val("Location"), val("Show starts")]).toEqual(["Fictional edited title", "Fictional Hall 3", ""]);
      fireEvent.click(screen.getByRole("button", { name: "Create event or edition" }));
      fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2027-05-04" } });
      fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2027-05-06" } });
      fireEvent.click(screen.getByRole("button", { name: "Add event and first edition" }));
      await waitFor(() => expect(posted("event_edition_id")).toBe("ed-new"));
      expect([val("Title"), val("Location")]).toEqual(["Fictional edited title", "Fictional Hall 3"]);
      expect([val("Show starts"), val("Show ends")]).toEqual(["2027-05-04", "2027-05-06"]);
      await waitFor(() => expect((screen.getByRole("combobox", { name: /Event \/ Exhibition/ }) as HTMLInputElement).value).toBe("Fictional Spring Show · 2027"));
    });
  });
});
