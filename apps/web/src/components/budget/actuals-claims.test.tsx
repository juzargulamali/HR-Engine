/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/projectBudget", () => ({
  decideActuals: vi.fn(), returnApprovedActuals: vi.fn(), reviseActuals: vi.fn(), saveActualsDraft: vi.fn(), startActuals: vi.fn(), submitActuals: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ActualsSection } from "./actuals-section";
import type { PbxBudgetView } from "@/types/budget";

afterEach(() => cleanup());

const row = {
  id: "r1", sort_no: 1, budget_row_id: "b1", line_no: 1, category_key: "travel", category_label: "Travel", description: "Flights", approved_amount: 500, actual_amount: 450,
  paid_via: "existing_claim", paid_by_user_id: null, paid_by_name: null, claim_id: "c1", foreign_currency: false, foreign_note: null, note: null, unplanned: false,
};
const view = ({
  viewer: { is_pm: true, is_finance: false, is_full_reader: true }, baseline: 500, people: [], categories: [{ id: "cat1", key: "travel", label: "Travel" }],
  project: { id: "p1", site_timezone: "Asia/Dubai" }, budget: { id: "bud1", currency: "AED", settlement_status: "open" },
  actuals: [{ id: "s1", seq: 1, status: "draft", row_version: 1, complete_confirmed: false, variance_note: null, rows: [row] }],
}) as unknown as PbxBudgetView;

describe("Actuals form: your expense claim picker", () => {
  it("healthy: the claim picker lists the claims", () => {
    render(<ActualsSection view={view} claims={[{ id: "c1", label: "2026-10-30 · AED 450.00 · approved" }]} />);
    expect(screen.getByLabelText("Your expense claim")).toBeTruthy();
    expect(screen.getByText(/2026-10-30 · AED 450.00/)).toBeTruthy();
    expect(screen.queryByText(/Could not load your expense claims/)).toBeNull();
  });
  it("genuinely no claims still offers the 'not listed' choice", () => {
    render(<ActualsSection view={view} claims={[]} />);
    expect(screen.getByText(/Not listed/)).toBeTruthy();
  });
  it("a failed claims read says so with a retry, and does not present an empty picker as 'no claims'", () => {
    render(<ActualsSection view={view} claims={[]} claimsFailed claimsRetryHref="/projects/p1/budget?section=actuals" />);
    expect(screen.getByText(/Could not load your expense claims/)).toBeTruthy();
    expect(screen.getByText(/The claim already linked to this line is kept/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe("/projects/p1/budget?section=actuals");
    expect(screen.queryByLabelText("Your expense claim")).toBeNull();
    expect(screen.queryByText(/Not listed/)).toBeNull();
  });
});
