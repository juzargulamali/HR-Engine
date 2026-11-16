/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ addInsurancePolicy: vi.fn(), prepareInsuranceUpload: vi.fn(), uploadToSignedUrl: vi.fn() }));
vi.mock("@/lib/actions/employees", () => ({ addInsurancePolicy: mocks.addInsurancePolicy, prepareInsuranceUpload: mocks.prepareInsuranceUpload }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }) } }) }));

import { AddInsuranceForm } from "./add-insurance-form";

const MB2 = 2 * 1024 * 1024;
const pdf = (name = "policy.pdf", size = MB2, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  mocks.addInsurancePolicy.mockReset().mockResolvedValue({ error: null });
  mocks.prepareInsuranceUpload.mockReset().mockResolvedValue({ error: null, bucket: "insurance-documents", path: "c/e/s-policy.pdf", token: "tok" });
  mocks.uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);

async function fillAndSubmit(file?: File) {
  fireEvent.change(screen.getByLabelText("Insurance name"), { target: { value: "Fictional Health" } });
  fireEvent.change(screen.getByLabelText("Policy number"), { target: { value: "FH-1" } });
  if (file) fireEvent.change(screen.getByLabelText(/Policy document/), { target: { files: [file] } });
  await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /add policy/i }).closest("form")!); });
}

describe("AddInsuranceForm", () => {
  it("a 2 MB document goes to private storage first; the policy is saved with only its name, type and size", async () => {
    const file = pdf();
    render(<AddInsuranceForm employeeId="e1" />);
    expect(screen.getByText("PDF, JPEG, PNG or WebP, up to 10 MB.")).toBeTruthy();
    await fillAndSubmit(file);
    await waitFor(() => expect(mocks.addInsurancePolicy).toHaveBeenCalled());
    expect(mocks.prepareInsuranceUpload).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "e1", name: "policy.pdf", size: MB2 }));
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith("c/e/s-policy.pdf", "tok", file, { contentType: "application/pdf" });
    const sent = mocks.addInsurancePolicy.mock.calls[0]![1] as FormData;
    expect(sent.get("file")).toBeNull();
    expect(sent.get("fileName")).toBe("policy.pdf");
    expect(sent.get("fileSize")).toBe(String(MB2));
    expect(sent.get("insuranceName")).toBe("Fictional Health");
  });
  it("refuses an oversize or wrong-type document inline before anything is sent", async () => {
    render(<AddInsuranceForm employeeId="e1" />);
    await fillAndSubmit(pdf("big.pdf", 10 * 1024 * 1024 + 1));
    expect(screen.getByTestId("insurance-file-error").textContent).toMatch(/too large/);
    await fillAndSubmit(pdf("a.docx", 100, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    expect(screen.getByTestId("insurance-file-error").textContent).toMatch(/Only PDF/);
    expect(mocks.prepareInsuranceUpload).not.toHaveBeenCalled();
    expect(mocks.addInsurancePolicy).not.toHaveBeenCalled();
  });
  it("an upload failure shows inline and saves nothing; the retry reuses the same submission id", async () => {
    mocks.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "network" } });
    render(<AddInsuranceForm employeeId="e1" />);
    await fillAndSubmit(pdf());
    expect(screen.getByTestId("insurance-file-error").textContent).toMatch(/could not be uploaded/);
    expect(mocks.addInsurancePolicy).not.toHaveBeenCalled();
    await act(async () => { fireEvent.submit(screen.getByRole("button", { name: /add policy/i }).closest("form")!); });
    await waitFor(() => expect(mocks.addInsurancePolicy).toHaveBeenCalledTimes(1));
    const ids = mocks.prepareInsuranceUpload.mock.calls.map((c) => (c[0] as { submissionId: string }).submissionId);
    expect(ids[1]).toBe(ids[0]);
  });
  it("shows the server's error and keeps what was typed", async () => {
    mocks.addInsurancePolicy.mockResolvedValue({ error: "row-level security" });
    render(<AddInsuranceForm employeeId="e1" />);
    await fillAndSubmit();
    await waitFor(() => expect(screen.getByText("row-level security")).toBeTruthy());
    expect((screen.getByLabelText("Policy number") as HTMLInputElement).value).toBe("FH-1");
    expect(mocks.prepareInsuranceUpload).not.toHaveBeenCalled();
  });
});
