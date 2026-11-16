/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const action = vi.hoisted(() => ({ addClaimLine: vi.fn(), prepareReceiptUpload: vi.fn() }));
const storage = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn() }));
vi.mock("@/lib/actions/reimbursements", () => action);
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => storage } }) }));

import { AddLineForm } from "./add-line-form";

const CLAIM = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  action.addClaimLine.mockReset();
  action.prepareReceiptUpload.mockReset().mockResolvedValue({ error: null, bucket: "receipts", path: "c/e/receipts/s-taxi.pdf", token: "tok" });
  storage.uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => cleanup());

async function fillAndSubmit(file?: File) {
  if (file) fireEvent.change(screen.getByLabelText("Receipt (optional)"), { target: { files: [file] } });
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

  describe("receipts go straight to private storage, never through the server action", () => {
    const pdf = (name = "taxi.pdf", size = 2 * 1024 * 1024, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });

    it("a 2 MB receipt: prepared by the server, sent to private storage, and the line saved with only the receipt's name, type and size", async () => {
      action.addClaimLine.mockResolvedValue({ error: null });
      const file = pdf();
      render(<AddLineForm claimId={CLAIM} />);
      await fillAndSubmit(file);
      await waitFor(() => expect(action.addClaimLine).toHaveBeenCalled());
      expect(action.prepareReceiptUpload).toHaveBeenCalledWith(expect.objectContaining({ claimId: CLAIM, name: "taxi.pdf", size: 2 * 1024 * 1024, type: "application/pdf" }));
      expect(storage.uploadToSignedUrl).toHaveBeenCalledWith("c/e/receipts/s-taxi.pdf", "tok", file, { contentType: "application/pdf" });
      const sent = action.addClaimLine.mock.calls[0]![1] as FormData;
      expect(sent.get("receipt")).toBeNull();
      expect(sent.get("receiptName")).toBe("taxi.pdf");
      expect(sent.get("receiptSize")).toBe(String(2 * 1024 * 1024));
      expect(sent.get("submissionId")).toBeTruthy();
    });
    it("says the limit and refuses an oversize or wrong-type receipt inline before anything is sent", async () => {
      render(<AddLineForm claimId={CLAIM} />);
      expect(screen.getByText("PDF, JPEG, PNG or WebP, up to 10 MB.")).toBeTruthy();
      await fillAndSubmit(pdf("big.pdf", 10 * 1024 * 1024 + 1));
      expect(screen.getByRole("alert").textContent).toMatch(/too large/);
      expect(action.prepareReceiptUpload).not.toHaveBeenCalled();
      expect(action.addClaimLine).not.toHaveBeenCalled();
      await fillAndSubmit(pdf("notes.docx", 1000, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
      expect(screen.getByRole("alert").textContent).toMatch(/Only PDF, JPEG, PNG, or WebP/);
      expect(action.addClaimLine).not.toHaveBeenCalled();
    });
    it("an upload failure shows inline, keeps what was typed and adds no line; the retry reuses the same submission id", async () => {
      storage.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "network" } });
      action.addClaimLine.mockResolvedValue({ error: null });
      render(<AddLineForm claimId={CLAIM} />);
      await fillAndSubmit(pdf());
      expect(screen.getByRole("alert").textContent).toMatch(/could not be uploaded/);
      expect(action.addClaimLine).not.toHaveBeenCalled();
      expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe("travel");
      await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /add line/i }).closest("form")!); });
      await waitFor(() => expect(action.addClaimLine).toHaveBeenCalledTimes(1));
      const ids = action.prepareReceiptUpload.mock.calls.map((c) => (c[0] as { submissionId: string }).submissionId);
      expect(ids[1]).toBe(ids[0]);
    });
    it("a saved line starts a new submission id for the next line", async () => {
      action.addClaimLine.mockResolvedValue({ error: null });
      render(<AddLineForm claimId={CLAIM} />);
      await fillAndSubmit(pdf());
      await waitFor(() => expect((screen.getByLabelText("Category") as HTMLInputElement).value).toBe(""));
      await fillAndSubmit(pdf());
      await waitFor(() => expect(action.addClaimLine).toHaveBeenCalledTimes(2));
      const ids = action.prepareReceiptUpload.mock.calls.map((c) => (c[0] as { submissionId: string }).submissionId);
      expect(ids[1]).not.toBe(ids[0]);
    });
  });
});
