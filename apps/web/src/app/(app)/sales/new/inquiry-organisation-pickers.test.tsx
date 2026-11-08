/**
 * @vitest-environment jsdom
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const created = vi.fn();
const loadInquiryOrganisations = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ checkDuplicates: vi.fn(), createOpportunity: (...a: unknown[]) => created(...a), updateOpportunity: vi.fn(), loadInquiryOrganisations: () => loadInquiryOrganisations() }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));

import { OrganisationPicker, type EnquiryOrganisation } from "./new-enquiry-form";
import { EditDetailsDialog, type EditableOpportunity } from "../opportunities/[id]/edit-details";

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };

afterEach(() => { cleanup(); created.mockReset(); loadInquiryOrganisations.mockReset(); });

const orgs: EnquiryOrganisation[] = [
  { id: "both", name: "Fictional Both Roles Co", kind: "agency", roles: ["agency", "client"], place: null },
  { id: "agency", name: "Fictional Agency Only", kind: "agency", roles: ["agency"], place: null },
  { id: "client", name: "Fictional Client Only", kind: "client", roles: ["client"], place: null },
  { id: "direct", name: "Fictional Direct Co", kind: "direct", roles: ["direct"], place: null },
  { id: "tech", name: "Fictional Tech Only", kind: "client", roles: ["technology"], place: null },
  { id: "legacy", name: "Fictional Legacy Client", kind: "client", roles: [], place: null },
];
const optionsOf = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value).filter(Boolean);

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

describe("create: the agency and end-client pickers honour organisation roles", () => {
  it("one organisation with roles agency and client can be selected in BOTH pickers; the list of organisations does not grow", () => {
    let chosen = { agency: "", client: "" };
    render(<Pickers onChange={(v) => { chosen = v; }} />);
    fireEvent.change(screen.getByLabelText("Agency"), { target: { value: "both" } });
    fireEvent.change(screen.getByLabelText("End client"), { target: { value: "both" } });
    expect(chosen).toEqual({ agency: "both", client: "both" });
    expect(orgs).toHaveLength(6);   // selecting creates nothing: the same record is the agency and the client
    expect(optionsOf("Agency").filter((v) => v === "both")).toHaveLength(1);
  });
  it("an organisation without the role is not offered; legacy records read as their kind", () => {
    render(<Pickers onChange={() => undefined} />);
    expect(optionsOf("Agency")).toEqual(["both", "agency"]);
    expect(optionsOf("End client")).toEqual(["both", "client", "direct", "legacy"]);
  });
  it("typing narrows the list and a miss says what is recorded as an agency", () => {
    render(<Pickers onChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Search agency"), { target: { value: "zzz" } });
    expect(optionsOf("Agency")).toEqual([]);
    expect(screen.getByText(/Nothing recorded as an agency matches/)).toBeTruthy();
  });
});

describe("edit: Edit details offers the same role-aware pickers", () => {
  const data: EditableOpportunity = {
    id: "opp", version: 3, agencyOrgId: "agency", clientOrgId: "client", title: "T", brief: null, currency: "AED", value: null, budgetNote: null, paymentTerms: null,
    eventStart: null, eventEnd: null, installStart: null, location: null, scope: null, exclusions: null, waitingOn: null, technologies: [], risks: [],
  };
  const open = () => render(<EditDetailsDialog open onClose={() => undefined} data={data} mode="full" availabilityWillNeedRecheck={false} />);
  const formNames = (form: HTMLFormElement) => Array.from(new FormData(form).keys());

  it("the multi-role organisation can be chosen as the agency and as the end client; one that lacks the role is absent", async () => {
    loadInquiryOrganisations.mockResolvedValue({ ok: true, organisations: orgs });
    open();
    await waitFor(() => expect((screen.getByLabelText("Agency") as HTMLSelectElement).disabled).toBe(false));
    expect(optionsOf("Agency")).toEqual(["both", "agency"]);
    expect(optionsOf("End client")).toEqual(["both", "client", "direct", "legacy"]);
    expect(optionsOf("Agency")).not.toContain("tech");
    fireEvent.change(screen.getByLabelText("Agency"), { target: { value: "both" } });
    fireEvent.change(screen.getByLabelText("End client"), { target: { value: "both" } });
    const form = screen.getByLabelText("Agency").closest("form") as HTMLFormElement;
    const posted = new FormData(form);
    expect([posted.get("agency_org_id"), posted.get("client_org_id")]).toEqual(["both", "both"]);
  });
  it("saving other details does not post the agency or end client (nothing is rewritten or logged as changed)", async () => {
    loadInquiryOrganisations.mockResolvedValue({ ok: true, organisations: orgs });
    open();
    await waitFor(() => expect((screen.getByLabelText("Agency") as HTMLSelectElement).disabled).toBe(false));
    const names = formNames(screen.getByLabelText("Agency").closest("form") as HTMLFormElement);
    expect(names).not.toContain("agency_org_id");
    expect(names).not.toContain("client_org_id");
  });
  it("a failed load says so and offers no empty pickers", async () => {
    loadInquiryOrganisations.mockResolvedValue({ ok: false, error: "Could not load the organisations. Close this and try again." });
    open();
    expect(await screen.findByText(/Could not load the organisations/)).toBeTruthy();
    expect(screen.queryByLabelText("Agency")).toBeNull();
  });
  it("an older inquiry whose organisation lacks the role still shows it as the current choice", async () => {
    loadInquiryOrganisations.mockResolvedValue({ ok: true, organisations: orgs });
    render(<EditDetailsDialog open onClose={() => undefined} data={{ ...data, agencyOrgId: "client" }} mode="full" availabilityWillNeedRecheck={false} />);
    await waitFor(() => expect((screen.getByLabelText("Agency") as HTMLSelectElement).disabled).toBe(false));
    expect(optionsOf("Agency")).toContain("client");
    expect((screen.getByLabelText("Agency") as HTMLSelectElement).value).toBe("client");
  });
});
