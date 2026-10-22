/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { candidateBase } from "@/lib/inventory/stock-candidates";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/inventory", useSearchParams: () => new URLSearchParams("q=laptop&action=scan") }));
vi.mock("@/lib/actions/inventoryStock", () => ({ readCode: vi.fn() }));

import { ScanPanelBody } from "./scan-panel";

afterEach(() => { cleanup(); push.mockClear(); });

const cand = candidateBase({ key: "k", type: "unit", itemId: "i1", itemName: "Laptop" });
const type = (code: string) => { fireEvent.change(screen.getByLabelText(/type the code/i), { target: { value: code } }); fireEvent.click(screen.getByRole("button", { name: /look up/i })); };

describe("ScanPanelBody", () => {
  it("opens the unit's panel for a unit code and keeps the list's own filters", async () => {
    const read = vi.fn(async () => ({ ok: true as const, kind: "unit" as const, unitId: "u1", itemId: "i1", code: "UAE-E-00042", candidate: cand }));
    render(<ScanPanelBody read={read} />);
    type("UAE-E-00042");
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0]![0]).toBe("/inventory?q=laptop&unit=u1");
  });
  it("opens the item focused on the bin for a bin label", async () => {
    const read = vi.fn(async () => ({ ok: true as const, kind: "stock" as const, itemId: "i2", code: "UAE-S-00007", candidate: cand }));
    render(<ScanPanelBody read={read} />);
    type("UAE-S-00007");
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0]![0]).toBe("/inventory?q=laptop&open=i2&bin=UAE-S-00007");
  });
  it("says so safely for a code that is unknown or not theirs, and goes nowhere", async () => {
    const read = vi.fn(async () => ({ ok: false as const, message: "No equipment or stock with that code was found, or you do not have access to it." }));
    render(<ScanPanelBody read={read} />);
    type("UAE-E-09999");
    expect(await screen.findByText(/found, or you do not have access/i)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
  it("survives a failed lookup", async () => {
    render(<ScanPanelBody read={async () => { throw new Error("offline"); }} />);
    type("UAE-E-00042");
    expect(await screen.findByText(/could not be looked up right now/i)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
