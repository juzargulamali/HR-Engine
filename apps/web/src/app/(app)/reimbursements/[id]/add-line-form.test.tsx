/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const action = vi.hoisted(() => ({ addClaimLine: vi.fn() }));
vi.mock("@/lib/actions/reimbursements", () => action);

import { AddLineForm } from "./add-line-form";

const CLAIM = "11111111-1111-4111-8111-111111111111";

beforeEach(() => action.addClaimLine.mockReset());
afterEach(() => cleanup());

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Expense date"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "travel" } });
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "42.5" } });
  fireEvent.change(screen.getByLabelText("Description (optional)"), { target: { value: "Taxi to the venue" } });
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: /add line/i }).closest("form")!);
  });
}

describe("AddLineForm", () => {
  it("keeps what was typed and shows the message when the line could not be added", async () => {
    action.addClaimLine.mockResolvedValue({ error: "Could not add the line: no access" });
    render(<AddLineForm claimId={CLAIM} />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByText("Could not add the line: no access")).toBeTruthy());
    expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("travel");
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("42.5");
    expect((screen.getByLabelText("Description (optional)") as HTMLInputElement).value).toBe("Taxi to the venue");
  });

  it("clears the form once the line was saved", async () => {
    action.addClaimLine.mockResolvedValue({ error: null });
    render(<AddLineForm claimId={CLAIM} />);
    await fillAndSubmit();
    await waitFor(() => expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe(""));
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("");
    const sent = action.addClaimLine.mock.calls[0]![1] as FormData;
    expect(sent.get("claimId")).toBe(CLAIM);
    expect(sent.get("category")).toBe("travel");
  });
});
