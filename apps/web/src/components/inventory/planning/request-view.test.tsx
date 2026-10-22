/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/inventoryPlanning", () => {
  const names = ["saveRequestPlan", "submitRequest", "cancelRequest", "addRequestLine", "expandTechnology", "updateRequestLine", "cancelRequestLine", "proposeSubstitution", "decideSubstitution",
    "setShortageAction", "reserveLine", "releaseReservation", "unitsForReserve", "searchItems", "lookupEmployees"];
  return Object.fromEntries(names.map((n) => [n, vi.fn(async () => ({ error: null }))]));
});

import type { InvRequestRow, InvLocationRow } from "@/types/inventory";
import type { RequestModel } from "@/lib/inventory/planning-data";
import { lineProgress, substitutionInfo } from "@/lib/inventory/planning";
import { RequestEditor } from "./request-view";
import type { EditorCan } from "./lines-editor";

afterEach(() => cleanup());

const request = (over: Partial<InvRequestRow> = {}): InvRequestRow => ({
  id: "r1", company_id: "c1", code: "UAE-R-00007", kind: "project", project_id: "p1", employee_id: null, requested_by: "u1", status: "draft", title: "LED tunnel", destination: "Dubai Mall",
  pickup_location_id: "loc1", timezone: "Asia/Dubai", plan: { dispatch: "2030-03-30T12:00", return_due: "2030-04-03T10:00" }, needed_from: "2030-03-30T08:00:00.000Z",
  needed_until: "2030-04-03T06:00:00.000Z", expected_return_at: null, source: "manual", source_ref: null, note: null, version: 3, submitted_at: null, cancelled_at: null,
  cancel_reason: null, created_at: "2030-01-01T00:00:00Z", updated_at: "2030-01-01T00:00:00Z", ...over,
});
const base = { id: "l1", itemId: "i1", itemName: "LED panel", itemModel: "P2.6", tracking: "quantity", unit: "each", scale: 0, qty: 10, note: null, status: "open" as const, version: 1, technologyName: null, altGroup: null, isOptional: false, originalItemId: null, originalItemName: null, substitution: substitutionInfo({ substitution_status: "none" }), substitutionNote: null, substituteOptions: [], shortageAction: "none", shortageNote: null, rentalReference: null };
const model = (req: InvRequestRow, lines = [base], outstanding = 0): RequestModel => ({
  request: req, forLabel: "Mall activation", requestedByName: "You", outstanding,
  lines: lines.map((l) => ({ ...l, progress: lineProgress(l, req, []), reservations: [] })),
});
const locations = [{ id: "loc1", company_id: "c1", name: "Dubai warehouse", timezone: "Asia/Dubai" }] as InvLocationRow[];
const can = (over: Partial<EditorCan> = {}): EditorCan => ({ edit: true, decide: true, warehouse: false, operableLocationIds: [], ...over });

describe("one request, as the panel and the project page show it", () => {
  it("lets the project manager prepare a draft: dates in the request's time zone, lines, a submit that explains itself", () => {
    render(<RequestEditor model={model(request())} can={can()} locations={locations} technologies={[]} />);
    expect(screen.getByText("UAE-R-00007")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText(/30 Mar 2030, 12:00 to 3 Apr 2030, 10:00 \(Asia\/Dubai\)/)).toBeTruthy();
    expect(screen.getByLabelText("Dispatch and transport")).toBeTruthy();
    expect((screen.getByLabelText("Dispatch and transport") as HTMLInputElement).value).toBe("2030-03-30T12:00");
    expect(screen.getByLabelText("Time zone of these dates")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit to the warehouse" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save the dates" })).toBeTruthy();
    expect(screen.getByText("Add an item")).toBeTruthy();
    expect(screen.getByText("Add from a technology template")).toBeTruthy();
  });

  it("tells a draft without lines or dates what is missing instead of offering Submit", () => {
    render(<RequestEditor model={model(request({ needed_from: null, needed_until: null, plan: {} }), [])} can={can()} locations={locations} technologies={[]} />);
    expect(screen.getByText(/To submit: add at least one item/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit to the warehouse" })).toBeNull();
  });

  it("gives warehouse people Dispatch for a project request and the date change for a submitted one", () => {
    render(<RequestEditor model={model(request({ status: "submitted" }))} can={can({ warehouse: true, operableLocationIds: ["loc1"] })} locations={locations} technologies={[]} />);
    expect(screen.getByRole("link", { name: "Dispatch" }).getAttribute("href")).toBe("/inventory?action=dispatch&request=r1&project=p1");
    expect(screen.getByRole("button", { name: "Change the dates" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reserve" })).toBeTruthy();
  });

  it("links an employee request to Issue with the employee, and shows no Dispatch", () => {
    render(<RequestEditor model={model(request({ kind: "employee", project_id: null, employee_id: "e1", status: "submitted" }))} can={can({ warehouse: true, operableLocationIds: ["loc1"] })} locations={locations} technologies={[]} />);
    expect(screen.getByRole("link", { name: "Issue to the employee" }).getAttribute("href")).toBe("/inventory?action=issue&request=r1&employee=e1");
    expect(screen.queryByRole("link", { name: "Dispatch" })).toBeNull();
    expect(screen.getByRole("link", { name: "What this employee holds" }).getAttribute("href")).toBe("/inventory/employees?employee=e1");
  });

  it("is read-only for someone who cannot change it, and the dates are listed rather than editable", () => {
    render(<RequestEditor model={model(request({ status: "submitted" }))} can={can({ edit: false, decide: false })} locations={locations} technologies={[]} />);
    expect(screen.queryByRole("button", { name: "Change the dates" })).toBeNull();
    expect(screen.queryByText("Add an item")).toBeNull();
    expect(screen.getByText("Dispatch and transport")).toBeTruthy();
    expect(screen.getByText(/The warehouse reserves and dispatches/)).toBeTruthy();
  });

  it("says what a cancellation did not do: equipment already dispatched is still out", () => {
    render(<RequestEditor model={model(request({ status: "cancelled", cancel_reason: "Client postponed" }), [base], 3)} can={can({ edit: false })} locations={locations} technologies={[]} />);
    expect(screen.getByText(/Cancelled: Client postponed/)).toBeTruthy();
    expect(screen.getByText(/Cancelling did not bring it back/)).toBeTruthy();
  });

  it("marks a request imported from the Sales handover", () => {
    render(<RequestEditor model={model(request({ source: "sales_handover" }))} can={can()} locations={locations} technologies={[]} />);
    expect(screen.getByText("Imported from the Sales handover")).toBeTruthy();
  });
});
