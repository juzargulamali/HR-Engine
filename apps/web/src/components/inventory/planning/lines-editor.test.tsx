/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/inventoryPlanning", () => ({
  cancelRequestLine: vi.fn(), decideSubstitution: vi.fn(), proposeSubstitution: vi.fn(), releaseReservation: vi.fn(), reserveLine: vi.fn(),
  setShortageAction: vi.fn(), unitsForReserve: vi.fn(), updateRequestLine: vi.fn(),
}));

import type { LineModel } from "@/lib/inventory/planning-data";
import { substitutionInfo } from "@/lib/inventory/planning";
import { LinesEditor, type EditorCan, type EditorRequest } from "./lines-editor";
import { SubstitutionBadge } from "./substitution";

afterEach(() => cleanup());

const request: EditorRequest = { id: "r1", status: "submitted", kind: "project", projectId: "p1", timezone: "Asia/Dubai", neededFrom: "2030-03-30T08:00:00.000Z", neededUntil: "2030-04-02T20:00:00.000Z", pickupLocationId: "loc1" };
const progress = { reserved: 0, reservedForWindow: 0, dispatched: 0, returned: 0, outstanding: 0, toReserve: 4, shortage: 4 };
const line = (over: Partial<LineModel>): LineModel => ({
  id: "l1", itemId: "i1", itemName: "Projector A", itemModel: null, tracking: "individual", unit: "each", scale: 0, qty: 4, note: null, status: "open", version: 1, technologyName: "Projection", altGroup: "projector", isOptional: false,
  originalItemId: null, originalItemName: null, substitution: substitutionInfo({ substitution_status: "none" }), substitutionNote: null, substituteOptions: [],
  shortageAction: "none", shortageNote: null, rentalReference: null, progress, reservations: [], ...over,
});
const proposed = line({
  id: "l2", itemName: "Projector B", originalItemId: "i1", originalItemName: "Projector A",
  substitution: substitutionInfo({ substitution_status: "proposed", original_item_name: "Projector A", item_name: "Projector B" }),
});
const can = (over: Partial<EditorCan> = {}): EditorCan => ({ edit: true, decide: false, warehouse: false, operableLocationIds: [], ...over });
const locations = [{ id: "loc1", name: "Dubai warehouse" }];

describe("substitution marking", () => {
  it("a proposed substitute is marked 'Substitute — not yet accepted' and says what is kept until then", () => {
    render(<SubstitutionBadge status="proposed" originalItemName="Projector A" itemName="Projector B" />);
    expect(screen.getByText("Substitute — not yet accepted")).toBeTruthy();
    expect(screen.getByText(/keeps preparing Projector A until the project manager accepts Projector B/)).toBeTruthy();
  });
  it("shows nothing for a line without a substitution, and marks accepted and declined in words", () => {
    const { container, rerender } = render(<SubstitutionBadge status="none" />);
    expect(container.textContent).toBe("");
    rerender(<SubstitutionBadge status="accepted" originalItemName="A" itemName="B" />);
    expect(screen.getByText("Substitute accepted")).toBeTruthy();
    rerender(<SubstitutionBadge status="declined" originalItemName="A" />);
    expect(screen.getByText("Substitute declined")).toBeTruthy();
  });
});

describe("the lines table", () => {
  it("marks the substitute line and leaves the standard line unmarked", () => {
    render(<LinesEditor request={request} lines={[line({}), proposed]} can={can()} locations={locations} />);
    expect(screen.getAllByText("Substitute — not yet accepted")).toHaveLength(1);
    const row = screen.getByText("Projector B").closest("tr")!;
    expect(within(row).getByText("Substitute — not yet accepted")).toBeTruthy();
  });

  it("offers Accept or decline only to people accountable for the request, never to the warehouse alone", () => {
    const { rerender } = render(<LinesEditor request={request} lines={[proposed]} can={can({ decide: true })} locations={locations} />);
    expect(screen.getByRole("button", { name: "Accept or decline" })).toBeTruthy();
    rerender(<LinesEditor request={request} lines={[proposed]} can={can({ decide: false, warehouse: true, operableLocationIds: ["loc1"] })} locations={locations} />);
    expect(screen.queryByRole("button", { name: "Accept or decline" })).toBeNull();
  });

  it("offers Reserve to warehouse people at a location they work at, not to the project manager", () => {
    const { rerender } = render(<LinesEditor request={request} lines={[line({})]} can={can({ warehouse: true, operableLocationIds: ["loc1"] })} locations={locations} />);
    expect(screen.getByRole("button", { name: "Reserve" })).toBeTruthy();
    rerender(<LinesEditor request={request} lines={[line({})]} can={can({ warehouse: true, operableLocationIds: [] })} locations={locations} />);
    expect(screen.queryByRole("button", { name: "Reserve" })).toBeNull();
    rerender(<LinesEditor request={request} lines={[line({})]} can={can()} locations={locations} />);
    expect(screen.queryByRole("button", { name: "Reserve" })).toBeNull();
  });

  it("shows reserved, dispatched, returned and outstanding, and keeps a cancelled line's outstanding equipment visible", () => {
    const out = line({ id: "l3", itemName: "Laptop", qty: 2, status: "cancelled", progress: { ...progress, reserved: 2, dispatched: 2, returned: 1, outstanding: 1, shortage: 0, toReserve: 0 } });
    render(<LinesEditor request={request} lines={[out]} can={can()} locations={locations} />);
    const row = screen.getByText(/Laptop/).closest("tr")!;
    expect(row.textContent).toContain("(cancelled)");
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(1, 6)).toEqual(["2", "2", "2", "1", "1"]);
    expect(screen.queryByRole("button", { name: "Reserve" })).toBeNull();
  });

  it("says short by how much, and what is planned for it", () => {
    render(<LinesEditor request={request} lines={[line({ shortageAction: "need_to_rent", rentalReference: "Q-77" })]} can={can()} locations={locations} />);
    expect(screen.getByText("short by 4")).toBeTruthy();
    expect(screen.getByText(/If short: Need to rent/)).toBeTruthy();
    expect(screen.getByText("Ref Q-77")).toBeTruthy();
  });

  it("says there are no lines instead of showing an empty table", () => {
    render(<LinesEditor request={request} lines={[]} can={can()} locations={locations} />);
    expect(screen.getByText(/No lines yet/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
