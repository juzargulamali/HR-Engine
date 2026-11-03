/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const saveActualsDraft = vi.fn();
vi.mock("@/lib/actions/projectBudget", () => ({
  decideActuals: vi.fn(), returnApprovedActuals: vi.fn(), reviseActuals: vi.fn(), startActuals: vi.fn(), submitActuals: vi.fn(),
  saveActualsDraft: (...a: unknown[]) => saveActualsDraft(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { ActualsSection } from "./actuals-section";
import type { PbxBudgetView } from "@/types/budget";

afterEach(() => { cleanup(); saveActualsDraft.mockReset(); });

const row = (n: number, over: Record<string, unknown> = {}) => ({
  id: `r${n}`, sort_no: n, budget_row_id: `b${n}`, line_no: 1, category_key: "food", category_label: "Food", description: `Line ${n}`, approved_amount: 100,
  actual_amount: null, paid_via: null, paid_by_user_id: null, paid_by_name: null, claim_id: null, foreign_currency: false, foreign_note: null, note: null, unplanned: false, ...over,
});
const view = (rows: ReturnType<typeof row>[]) => ({
  viewer: { user_id: "pm", is_pm: true, is_finance: false, is_executive: false, is_view_only: false, is_full_reader: true },
  project: { id: "p1", site_timezone: "Asia/Dubai" }, default_currency: "AED", baseline: 300,
  budget: { id: "b", currency: "AED", settlement_status: "open" },
  versions: [], funding: [], payments: [], settlement: null, categories: [{ id: "c1", key: "other", label: "Other" }], rates: [],
  people: [{ id: "pm", name: "Priya", role: "pm" }, { id: "u2", name: "Omar", role: "member" }],
  actuals: [{ id: "s1", seq: 1, status: "draft", complete_confirmed: false, variance_note: null, total_actual: 0, total_approved_budget: 300, row_version: 3, rows }],
}) as unknown as PbxBudgetView;

const type = (label: string, v: string) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } });

describe("actual expenses: how paid and who paid are asked once", () => {
  it("applies the default to every line with an amount and saves each line with its effective payment", async () => {
    saveActualsDraft.mockResolvedValue({ error: null, version: 4 });
    render(<ActualsSection view={view([row(1), row(2), row(3)])} claims={[]} />);
    type("How paid (all lines)", "personal");
    expect((screen.getByLabelText("Who paid (all lines)") as HTMLSelectElement).value).toBe("pm"); // the person entering is the default payer
    const amounts = screen.getAllByLabelText("Actual (AED)");
    fireEvent.change(amounts[0]!, { target: { value: "40" } });
    fireEvent.change(amounts[1]!, { target: { value: "25.5" } });
    fireEvent.change(amounts[2]!, { target: { value: "0" } });
    // No per-line "How was it paid?" on the lines that follow the default.
    expect(screen.queryAllByLabelText("How was it paid?")).toHaveLength(0);
    expect(screen.getAllByText("Different for this line")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveActualsDraft).toHaveBeenCalled());
    const rows = saveActualsDraft.mock.calls[0]![0].rows;
    expect(rows.map((r: Record<string, unknown>) => [r.actual_amount, r.paid_via, r.paid_by_user_id])).toEqual([["40", "personal", "pm"], ["25.5", "personal", "pm"], ["0", null, null]]);
  });

  it("a line can differ without changing the others", async () => {
    saveActualsDraft.mockResolvedValue({ error: null, version: 4 });
    render(<ActualsSection view={view([row(1), row(2)])} claims={[]} />);
    type("How paid (all lines)", "personal");
    const amounts = screen.getAllByLabelText("Actual (AED)");
    fireEvent.change(amounts[0]!, { target: { value: "40" } });
    fireEvent.change(amounts[1]!, { target: { value: "10" } });
    fireEvent.click(screen.getAllByText("Different for this line")[1]!);
    fireEvent.change(screen.getByLabelText("How was it paid?"), { target: { value: "company_card" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveActualsDraft).toHaveBeenCalled());
    const rows = saveActualsDraft.mock.calls[0]![0].rows;
    expect(rows.map((r: Record<string, unknown>) => [r.paid_via, r.paid_by_user_id])).toEqual([["personal", "pm"], ["company_card", null]]);
  });

  it("a saved draft whose lines were all paid the same way opens with that as the default", () => {
    const paid = (n: number) => row(n, { actual_amount: 10, paid_via: "advance", paid_by_user_id: "u2", paid_by_name: "Omar" });
    render(<ActualsSection view={view([paid(1), paid(2), row(3, { actual_amount: 5, paid_via: "company_card" })])} claims={[]} />);
    expect((screen.getByLabelText("How paid (all lines)") as HTMLSelectElement).value).toBe("advance");
    expect((screen.getByLabelText("Who paid (all lines)") as HTMLSelectElement).value).toBe("u2");
    // the line that was paid another way keeps its own choice
    expect((screen.getByLabelText("How was it paid?") as HTMLSelectElement).value).toBe("company_card");
  });
});
