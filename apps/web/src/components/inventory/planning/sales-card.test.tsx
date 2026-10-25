/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
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
    expect(screen.getByText(/Recorded by Amal Haddad/)).toBeTruthy();
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

describe("recorded check versus current availability", () => {
  const live = (result: string, summary: unknown[]) => ({ live: { result, summary } });
  const row = (status: string) => [{ technology: "LED tunnel", qty: 2, status }];

  it("shows the last recorded check and the current availability as two separate things", () => {
    render(<AvailabilityCardView {...props} view={view(checked(live("available", row("available"))))} />);
    expect(screen.getByLabelText("Last recorded check")).toBeTruthy();
    expect(screen.getByLabelText("Current availability")).toBeTruthy();
    expect(screen.getByText(/This is what the warehouse found then/)).toBeTruthy();
    expect(screen.getByText(/It is not a recorded check and changes as stock moves/)).toBeTruthy();
    expect(screen.queryByText(/Stock has changed since the last check/)).toBeNull();
  });

  it("warns, naming the technology, when current stock no longer supports the recorded result", () => {
    render(<AvailabilityCardView {...props} view={view(checked(live("short", row("short"))))} />);
    expect(screen.getByText(/Stock has changed since the last check: the recorded result is no longer supported for LED tunnel/)).toBeTruthy();
    const recorded = screen.getByLabelText("Last recorded check");
    const current = screen.getByLabelText("Current availability");
    expect(recorded.textContent).toContain("Available");   // the old result is not rewritten
    expect(current.textContent).toContain("Not enough in stock");
    expect(document.querySelector("[data-live-tone]")?.getAttribute("data-live-tone")).toBe("bad");
  });

  it("does not warn when stock is the same or better, or when the enquiry itself changed (out of date says that)", () => {
    const better = view(checked(live("available", row("available")), { result: "partial", summary: row("partial") }));
    expect(better.stockChanged).toBeNull();
    const outOfDate = view(checked({ needs_recheck: true, ...live("short", row("short")) }));
    expect(outOfDate.stockChanged).toBeNull();
    expect(outOfDate.outOfDate).toBe(true);
  });

  it("shows current availability for a request that is still pending, but no stock-changed warning", () => {
    const v = view({ state: "pending", pending: { requested_by: "Sales A", requested_at: "2030-01-05T09:00:00Z" }, live: { result: "partial", summary: row("partial") } });
    render(<AvailabilityCardView {...props} view={v} />);
    expect(screen.getByText(/No check is recorded yet/)).toBeTruthy();
    expect(screen.getByLabelText("Current availability").textContent).toContain("Partly available");
    expect(v.stockChanged).toBeNull();
  });

  it("shows no current-availability block when nothing named a location yet", () => {
    render(<AvailabilityCardView {...props} view={view({ state: "none" })} />);
    expect(screen.queryByLabelText("Current availability")).toBeNull();
  });
});

describe("the card loader", () => {
  const p = { opportunityId: "o1", companyId: "c1", stage: "qualified", canAsk: true };

  it("says it could not load, with a Retry, when the data service fails, and never throws into the Sales panel", async () => {
    for (const fail of [() => rpc.mockResolvedValue({ data: null, error: { message: "connection refused", code: "08006" } }), () => rpc.mockRejectedValue(new Error("network down"))]) {
      fail();
      const el = await EquipmentAvailabilityCardContent(p);
      expect(el).not.toBeNull();
      const { unmount } = render(el!);
      expect(screen.getByText("Could not load—retry")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(document.querySelector("[data-tone]")).toBeNull(); // no made-up answer
      unmount();
    }
  });

  it("Retry asks the server for the card again", async () => {
    rpc.mockRejectedValue(new Error("network down"));
    refresh.mockClear();
    render((await EquipmentAvailabilityCardContent(p))!);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats an answer it cannot read as a failed load, not as 'no check'", async () => {
    rpc.mockResolvedValue({ data: { state: "unknown shape" }, error: null });
    render((await EquipmentAvailabilityCardContent(p))!);
    expect(screen.getByText("Could not load—retry")).toBeTruthy();
  });

  it("renders nothing when Inventory is not installed or the person has no use for it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Could not find the function public.inv_opportunity_availability in the schema cache", code: "PGRST202" } });
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: "Opportunity not found", code: "P0002" } });
    expect(await EquipmentAvailabilityCardContent(p)).toBeNull();
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied", code: "42501" } });
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
