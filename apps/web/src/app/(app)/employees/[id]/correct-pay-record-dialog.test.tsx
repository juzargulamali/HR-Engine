/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
const correctPayRecord = vi.fn();
vi.mock("@/lib/actions/payCorrection", () => ({ correctPayRecord: (...a: unknown[]) => correctPayRecord(...a) }));

import { CorrectPayRecordButton, type CorrectPayRecordProps } from "./correct-pay-record-dialog";

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

// Fictional: hired 1 Jan 2024; the only pay record is the current salary saved with the joining date. Today 16 Nov 2026.
const record = { id: "rec-1", effective_from: "2024-01-01", base_salary: 8000, allowances: { housing: 1000, other: 500 }, currency: "AED", is_current: true, created_at: "2024-01-01T08:00:00Z" };
const props: CorrectPayRecordProps = { employeeId: "emp-1", employeeName: "Fictional Technician", companyName: "Fictional Aurora LLC", hireDate: "2024-01-01", today: "2026-11-16", record, records: [record], pending: [] };
const posted = () => Object.fromEntries((correctPayRecord.mock.calls[0]![1] as FormData).entries());
const open = () => { render(<CorrectPayRecordButton {...props} />); fireEvent.click(screen.getByRole("button", { name: "Correct pay record" })); };
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

beforeEach(() => { correctPayRecord.mockReset().mockResolvedValue({ error: null, saved: { message: "Saved. The pay record is corrected.", affects: [], repeat: false } }); });
afterEach(() => cleanup());

describe("Correct pay record", () => {
  it("opens on the entry, shows its current figures, and offers a review only once something changed and a reason is given", () => {
    open();
    expect(screen.getByTestId("correct-pay-which").textContent).toMatch(/1 Jan 2024.*8,000 AED basic.*9,500 AED in total.*in force today/);
    expect(screen.getByText("Fictional Technician · Fictional Aurora LLC")).toBeTruthy();
    const review = screen.getByTestId("correct-pay-review") as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    expect(screen.queryByTestId("correct-pay-problem")).toBeNull();                 // no scolding before anything is typed
    type("Effective date", "2025-03-01");
    expect(review.disabled).toBe(true);                                             // still no reason
    type("Reason for the correction", "Entered with the joining date");
    expect(review.disabled).toBe(false);
  });

  it("explains a refused date in words as it is typed: before hire, after today, nothing changed", () => {
    open();
    type("Reason for the correction", "Entered with the joining date");
    type("Effective date", "2023-12-31");
    expect(screen.getByTestId("correct-pay-problem").textContent).toMatch(/cannot start before the hire date/);
    expect((screen.getByTestId("correct-pay-review") as HTMLButtonElement).disabled).toBe(true);
    type("Effective date", "2026-11-17");
    expect(screen.getByTestId("correct-pay-problem").textContent).toMatch(/cannot be later than today/);
    type("Effective date", "2024-01-01");
    expect(screen.getByTestId("correct-pay-problem").textContent).toMatch(/Nothing changed/);
  });

  it("the review shows old and new side by side, marks what changed, says which pay is in force before and after, and nothing is saved until confirmed", async () => {
    open();
    type("Effective date", "2025-03-01");
    type("Basic salary", "8800");
    type("Others", "700");
    type("Reason for the correction", "Entered with the joining date");
    fireEvent.click(screen.getByTestId("correct-pay-review"));
    const table = screen.getByTestId("correct-pay-compare");
    const rows = within(table).getAllByRole("row").slice(1);
    const read = (i: number) => [...rows[i]!.children].map((c) => c.textContent?.replace(" (changed)", ""));
    expect(read(0)).toEqual(["Effective from", "1 Jan 2024", "1 Mar 2025"]);
    expect(read(1)).toEqual(["Basic salary", "8,000 AED", "8,800 AED"]);
    expect(read(2)).toEqual(["Housing", "1,000 AED", "1,000 AED"]);
    expect(read(3)).toEqual(["Others", "500 AED", "700 AED"]);
    expect(read(4)).toEqual(["Total", "9,500 AED", "10,500 AED"]);
    expect(rows.map((r) => r.getAttribute("data-changed"))).toEqual(["true", "true", "false", "true", "true"]);
    const inForce = screen.getByTestId("correct-pay-in-force").textContent!;
    expect(inForce).toMatch(/before.*9,500 AED.*from 1 Jan 2024/);
    expect(inForce).toMatch(/after.*10,500 AED.*from 1 Mar 2025/);
    expect(screen.getByTestId("correct-pay-gap").textContent).toMatch(/no pay record is on file from 1 Jan 2024.*until 1 Mar 2025/);
    expect(screen.getByText("Entered with the joining date")).toBeTruthy();
    expect(correctPayRecord).not.toHaveBeenCalled();
    // Back returns to the form with the values kept.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByLabelText("Basic salary") as HTMLInputElement).value).toBe("8800");
  });

  it("Enter in the form never saves from the first step; confirming saves once with the request key, the new date, amount, allowances and reason", async () => {
    open();
    type("Effective date", "2025-03-01");
    type("Basic salary", "8800");
    type("Reason for the correction", "Entered with the joining date");
    fireEvent.submit(screen.getByTestId("correct-pay-form"));                        // Enter on the first step: goes to the review, saves nothing
    expect(correctPayRecord).not.toHaveBeenCalled();
    expect(screen.getByTestId("correct-pay-compare")).toBeTruthy();
    fireEvent.click(screen.getByTestId("correct-pay-confirm"));
    await waitFor(() => expect(correctPayRecord).toHaveBeenCalledTimes(1));
    expect(posted()).toMatchObject({
      employeeId: "emp-1", compensationId: "rec-1", effectiveDate: "2025-03-01", basicSalary: "8800", reason: "Entered with the joining date",
      allowances: JSON.stringify({ housing: 1000, other: 500 }),
    });
    expect(String(posted().requestKey).length).toBeGreaterThanOrEqual(8);
    expect(await screen.findByTestId("correct-pay-saved")).toBeTruthy();
    expect(screen.getByTestId("correct-pay-no-impact").textContent).toMatch(/No approved payroll export or final settlement/);
  });

  it("after saving it says what the correction affects, for review with Finance or payroll, and that nothing there was changed", async () => {
    correctPayRecord.mockResolvedValue({
      error: null,
      saved: { message: "Saved.", repeat: false, affects: ["The approved payroll export for March 2024 (sent to payroll on 2 Apr 2024) includes this person’s salary for this pay record’s period.", "This person’s final settlement (leaving date 30 Jun 2025) is worked out from this pay record, so its figures may change."] },
    });
    open();
    type("Basic salary", "8800");
    type("Reason for the correction", "Typed the wrong figure");
    fireEvent.click(screen.getByTestId("correct-pay-review"));
    fireEvent.click(screen.getByTestId("correct-pay-confirm"));
    const box = await screen.findByTestId("correct-pay-affects");
    expect(box.textContent).toMatch(/This correction affects/);
    expect(box.textContent).toMatch(/March 2024/);
    expect(box.textContent).toMatch(/final settlement/);
    expect(box.textContent).toMatch(/Nothing in payroll or in a settlement was changed. Review with Finance or payroll/);
  });

  it("a refusal from the server is shown in words on the review, with the form kept, and the same request key is used on retry", async () => {
    correctPayRecord.mockResolvedValueOnce({ error: "Another pay record already starts on 2025-03-01. Two pay records cannot start on the same day." });
    open();
    type("Basic salary", "8800");
    type("Reason for the correction", "Typed the wrong figure");
    fireEvent.click(screen.getByTestId("correct-pay-review"));
    fireEvent.click(screen.getByTestId("correct-pay-confirm"));
    expect((await screen.findByTestId("correct-pay-error")).textContent).toMatch(/already starts on 2025-03-01/);
    const firstKey = posted().requestKey;
    fireEvent.click(screen.getByTestId("correct-pay-confirm"));
    await waitFor(() => expect(correctPayRecord).toHaveBeenCalledTimes(2));
    expect((correctPayRecord.mock.calls[1]![1] as FormData).get("requestKey")).toBe(firstKey);
  });

  it("an allowance the record does not have is not sent unless an amount is entered for it", () => {
    const plain = { ...record, allowances: {} };
    render(<CorrectPayRecordButton {...props} record={plain} records={[plain]} />);
    fireEvent.click(screen.getByRole("button", { name: "Correct pay record" }));
    type("Basic salary", "8100");
    type("Reason for the correction", "Typed the wrong figure");
    fireEvent.click(screen.getByTestId("correct-pay-review"));
    const rows = within(screen.getByTestId("correct-pay-compare")).getAllByRole("row").slice(1).map((r) => r.getAttribute("data-changed"));
    expect(rows).toEqual(["false", "true", "true"]);                                // date, basic, total: no empty Others line
  });
});
