/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/projectBudget", () => ({ saveBudgetDraft: vi.fn(), submitBudget: vi.fn(), discardDraft: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { BudgetEditor } from "./budget-editor";
import type { PbxBudgetView, PbxVersion } from "@/types/budget";

afterEach(() => cleanup());

const cats = [{ id: "c-food", key: "food", label: "Food", is_default: true }, { id: "c-other", key: "other", label: "Other", is_default: true }];
const view = { project: { id: "p1" }, budget: { currency: "AED" }, categories: cats, rates: [], people: [{ id: "u1", name: "Priya", role: "pm" }, { id: "u2", name: "Omar", role: "member" }] } as unknown as PbxBudgetView;
const version = (over: Partial<PbxVersion> = {}) => ({ id: "v1", kind: "original", period_start: null, period_end: null, note: null, row_version: 1, people: [], rows: [], ...over }) as unknown as PbxVersion;

describe("budget lines: fewer repeated choices", () => {
  it("a new draft starts with every project member ticked; a saved draft keeps its own choice", () => {
    render(<BudgetEditor view={view} version={version()} />);
    expect((screen.getByLabelText(/Priya/) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/Omar/) as HTMLInputElement).checked).toBe(true);
    cleanup();
    render(<BudgetEditor view={view} version={version({ people: [{ id: "u2", name: "Omar" }], rows: [{ category_id: "c-food", date_from: null, date_to: null, activity: "other", description: "Lunch", basis: "fixed", people: null, days: null, qty: null, rate: null, fixed: 50, rate_key: null } as never] })} />);
    expect((screen.getByLabelText(/Priya/) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(/Omar/) as HTMLInputElement).checked).toBe(true);
  });

  it("duplicates a line right below it, with the same figures, and the total follows", () => {
    render(<BudgetEditor view={view} version={version()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add line/ })[0]!);
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Lunch" } });
    fireEvent.change(screen.getByLabelText("How is it calculated?"), { target: { value: "fixed" } });
    fireEvent.change(screen.getByLabelText(/^Total amount/), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate the line Lunch" }));
    const descriptions = screen.getAllByLabelText("Description") as HTMLInputElement[];
    expect(descriptions.map((d) => d.value)).toEqual(["Lunch", "Lunch"]);
    const totals = screen.getAllByTestId("line-total").map((t) => t.textContent);
    expect(totals[0]).toBe(totals[1]);
    expect(within(screen.getAllByRole("list")[0]!).getAllByTestId("line-total")).toHaveLength(2);
    expect(screen.getByText("AED 100.00")).toBeTruthy(); // 2 x 50 in the grand total
  });

  it("offers the activity last chosen on the next new line", () => {
    render(<BudgetEditor view={view} version={version()} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Add line/ })[0]!);
    fireEvent.change(screen.getByLabelText("Activity"), { target: { value: "show" } });
    fireEvent.click(screen.getAllByRole("button", { name: /Add line/ })[0]!);
    const acts = screen.getAllByLabelText("Activity") as HTMLSelectElement[];
    expect(acts.map((a) => a.value)).toEqual(["show", "show"]);
  });
});
