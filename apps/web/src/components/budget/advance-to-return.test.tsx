/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/projectBudget", () => ({
  closeSettlement: vi.fn(), confirmReceipts: vi.fn(), recordPayment: vi.fn(), recordReceipts: vi.fn(), reopenSettlement: vi.fn(), reversePayment: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { InboxList } from "./inbox-list";
import { SettlementSection } from "./settlement-section";
import { TO_RETURN_HINT, advanceToReturnText } from "./shared";
import type { PbxBudgetView, PbxInbox } from "@/types/budget";

afterEach(() => cleanup());

const person = { user_id: "u1", name: "Pia Presenter", advance_provided: 1000, advance_spent: 0, returned: 0, advance_balance: 1000, advance_to_return: 1000, advance_overspend: 0, personal_spent: 0, reimbursement_owed: 0, reimbursement_paid: 0, reimbursement_outstanding: 0 };
const settlement = (hasApproved: boolean) => ({
  currency: "AED", approved_budget: 5000, has_approved_actuals: hasApproved, approved_actual_total: hasApproved ? 600 : 0, advances_provided: 1000, card_allocations: 0,
  advance_spent: hasApproved ? 600 : 0, company_card_spent: 0, direct_paid: 0, personal_spent: 0, existing_claim_spent: 0, returned: 0, reimbursement_owed: 0, reimbursement_paid: 0,
  advance_to_return: hasApproved ? 400 : 1000, reimbursement_outstanding: 0, overpaid_reimbursement: false,
  per_person: [{ ...person, advance_spent: hasApproved ? 600 : 0, advance_to_return: hasApproved ? 400 : 1000 }], blockers: [],
});
const view = (hasApproved: boolean) => ({
  viewer: { is_finance: false }, budget: { currency: "AED", settlement_status: "open", receipts_status: "not_received" },
  settlement: settlement(hasApproved), project: {}, versions: [], actuals: [], funding: [], payments: [], people: [],
}) as unknown as PbxBudgetView;

describe("Advance still to be returned (D-12)", () => {
  it("helper: dash until approved actuals, the figure after", () => {
    expect(advanceToReturnText(false, 1000, "AED")).toBe("—");
    expect(advanceToReturnText(true, 400, "AED")).toContain("400");
  });

  it("settlement section: funding with no approved actuals shows the hint, not the full advance", () => {
    render(<SettlementSection view={view(false)} />);
    const tile = screen.getByText("Advance still to be returned").parentElement!;
    expect(tile.textContent).toContain("—");
    expect(tile.textContent).toContain(TO_RETURN_HINT);
    expect(tile.textContent).not.toContain("1,000");
    // By-person table: the Still to return cell is a dash with the reason
    const cell = screen.getByText("Pia Presenter").closest("tr")!.querySelectorAll("td")[4]!;
    expect(cell.textContent).toContain("—");
    expect(cell.textContent).toContain(TO_RETURN_HINT);
    expect(screen.getAllByText(/known once the final expenses are approved/i).length).toBeGreaterThan(1);
  });

  it("settlement section: after approval the figures equal the database", () => {
    render(<SettlementSection view={view(true)} />);
    const tile = screen.getByText("Advance still to be returned").parentElement!;
    expect(tile.textContent).toContain("400");
    expect(tile.textContent).not.toContain(TO_RETURN_HINT);
    const cell = screen.getByText("Pia Presenter").closest("tr")!.querySelectorAll("td")[4]!;
    expect(cell.textContent).toContain("400");
  });

  it("Finance inbox column: dash with the hint until approved, figure after", () => {
    const row = (has: boolean) => ({
      budget_id: "b", project_id: "p", reference: "P-1", name: "Expo", company_id: "c", company_name: "Co", currency: "AED", pm_name: "Pat", site_timezone: null,
      receipts_status: "not_received", settlement_route: "finance", receipts_confirmed: false, i_can_close: false, i_can_confirm_receipts: false,
      approved_budget: 5000, approved_actual_total: has ? 600 : null, has_approved_actuals: has, advance_to_return: has ? 400 : 1000, reimbursement_outstanding: 0, advances_provided: 1000, next: "x",
    });
    const inbox = (has: boolean) => ({ companies: [{ id: "c", name: "Co", is_finance: true, is_executive: false, can_decide: true }], budget_approvals: [], final_expense_approvals: [], outstanding_settlement: [row(has)], is_finance_anywhere: true, is_executive_anywhere: false }) as unknown as PbxInbox;
    const { unmount } = render(<InboxList inbox={inbox(false)} initialFilter="settlement" />);
    let tr = screen.getByText("Expo").closest("tr")!;
    expect(tr.textContent).toContain(TO_RETURN_HINT);
    expect(tr.textContent).not.toContain("1,000");
    unmount();
    render(<InboxList inbox={inbox(true)} initialFilter="settlement" />);
    tr = screen.getByText("Expo").closest("tr")!;
    expect(tr.textContent).toContain("400");
    expect(tr.textContent).not.toContain(TO_RETURN_HINT);
  });
});
