/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions/inventoryPlanning", () => ({ requestOpportunityCheck: vi.fn(), recordOpportunityCheck: vi.fn() }));
const rpc = vi.fn();
const eq2 = { order: async () => ({ data: [{ id: "loc1", name: "Dubai warehouse" }] }) };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from: () => ({ select: () => ({ eq: () => ({ eq: () => eq2 }) }) }) }) }));
vi.mock("@/lib/inventory/context", () => ({ getInventoryContext: vi.fn(async () => ({ grants: [{ companyId: "c1", capabilities: ["warehouse"] }] })) }));

import { salesCheckView } from "@/lib/inventory/planning";
import { AvailabilityCardView } from "./sales-card-view";
import { EquipmentAvailabilityCardContent } from "./sales-availability-card";

afterEach(() => cleanup());
beforeEach(() => { rpc.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

const checked = (over: Record<string, unknown> = {}, latest: Record<string, unknown> = {}) => ({
  state: "checked", needs_recheck: false,
  latest: { result: "available", checked_by: "Amal Haddad", checked_at: "2030-01-05T09:00:00Z", location_name: "Dubai warehouse", summary: [{ technology: "LED tunnel", qty: 2, status: "available" }], ...latest },
  ...over,
});
const view = (data: unknown) => salesCheckView(data)!;
/** The headline badge of the card (the only element carrying the tone). */
const badge = () => document.querySelector("[data-tone]") as HTMLElement;
const props = { opportunityId: "o1", locations: [{ id: "loc1", name: "Dubai warehouse" }], canAsk: true, canRecord: false };

describe("the Sales equipment availability card", () => {
  it("says 'Warehouse check required' when nothing was checked, and the badge is not green", () => {
    render(<AvailabilityCardView {...props} view={view({ state: "none", needs_recheck: false })} />);
    expect(badge().textContent).toBe("Warehouse check required");
    expect(badge().getAttribute("data-tone")).toBe("warn");
    expect(screen.queryByText("Available")).toBeNull();
  });

  it("never shows a technology without a complete template as available, even when the overall result says so", () => {
    render(<AvailabilityCardView {...props} view={view(checked({}, { summary: [{ technology: "LED tunnel", qty: 2, status: "available" }, { technology: "Kinetic rig", qty: 1, status: "check_required" }] }))} />);
    expect(screen.getByText("Kinetic rig").closest("li")?.textContent).toContain("Warehouse check required");
    expect(badge().textContent).toBe("Available");
    expect(badge().getAttribute("data-tone")).toBe("warn");
    expect(screen.getByText(/has no complete template/)).toBeTruthy();
  });

  it("shows a current complete 'Available' as the only green state", () => {
    render(<AvailabilityCardView {...props} view={view(checked())} />);
    expect(badge().getAttribute("data-tone")).toBe("good");
    expect(screen.getByText(/Checked by Amal Haddad/)).toBeTruthy();
    expect(screen.getByText(/against Dubai warehouse/)).toBeTruthy();
  });

  it("says plainly that the check is out of date and is not green then", () => {
    render(<AvailabilityCardView {...props} view={view(checked({ needs_recheck: true }))} />);
    expect(screen.getByText(/Out of date: dates, location, technologies or quantities changed since the check/)).toBeTruthy();
    expect(badge().textContent).toBe("Available");
    expect(badge().getAttribute("data-tone")).toBe("warn");
  });

  it("shows shortages and alternatives at summary level, and that checking reserves nothing", () => {
    render(<AvailabilityCardView {...props} view={view(checked({}, { result: "short", summary: [{ technology: "LED wall", qty: 1, status: "short", shortages: [{ item_name: "Panel", short: 6 }], alternatives: [{ instead_of: "Panel A", use: "Panel B" }] }] }))} />);
    expect(badge().textContent).toBe("Not enough in stock");
    expect(badge().getAttribute("data-tone")).toBe("bad");
    expect(screen.getByText("Panel: short by 6")).toBeTruthy();
    expect(screen.getByText(/Panel B instead of Panel A/)).toBeTruthy();
    expect(screen.getByText("Checking availability does not reserve anything.")).toBeTruthy();
  });

  it("offers 'Ask the warehouse to check' to the owner and 'Record the check now' only to warehouse people", () => {
    const { rerender } = render(<AvailabilityCardView {...props} view={view({ state: "none" })} />);
    expect(screen.getByRole("button", { name: "Ask the warehouse to check" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record the check now" })).toBeNull();
    rerender(<AvailabilityCardView {...props} canRecord view={view({ state: "none" })} />);
    expect(screen.getByRole("button", { name: "Record the check now" })).toBeTruthy();
    rerender(<AvailabilityCardView {...props} canAsk={false} view={view({ state: "none" })} />);
    expect(screen.queryByRole("button", { name: "Ask the warehouse to check" })).toBeNull();
  });
});

describe("the card loader", () => {
  const p = { opportunityId: "o1", companyId: "c1", stage: "qualified", canAsk: true };

  it("renders nothing when the data service fails, and never throws into the Sales panel", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "connection refused", code: "08006" } });
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
    rpc.mockRejectedValue(new Error("network down"));
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
  });

  it("renders nothing when Inventory is not installed or the person has no use for it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.inv_opportunity_availability in the schema cache", code: "PGRST202" } });
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: "Opportunity not found", code: "P0002" } });
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
    rpc.mockResolvedValue({ data: { state: "unknown shape" }, error: null });
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
  });

  it("renders the card for a recorded check, with the buttons the person is allowed", async () => {
    rpc.mockResolvedValue({ data: checked(), error: null });
    const el = await EquipmentAvailabilityCardContent(p);
    expect(el).not.toBeNull();
    render(el!);
    expect(badge().textContent).toBe("Available");
    expect(screen.getByRole("button", { name: "Record the check now" })).toBeTruthy();
  });

  it("offers no buttons on a closed enquiry", async () => {
    rpc.mockResolvedValue({ data: checked(), error: null });
    render((await EquipmentAvailabilityCardContent({ ...p, stage: "won" }))!);
    expect(screen.queryByRole("button", { name: /Ask the warehouse|Record the check/ })).toBeNull();
  });
});
