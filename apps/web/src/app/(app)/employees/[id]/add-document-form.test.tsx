/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addDocument: vi.fn(),
  prepareDocumentUpload: vi.fn(),
  uploadToSignedUrl: vi.fn(),
}));
vi.mock("@/lib/actions/employeeDocuments", () => ({ addDocument: mocks.addDocument, prepareDocumentUpload: mocks.prepareDocumentUpload }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }) } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { AddDocumentForm, type AddDocumentFormProps } from "./add-document-form";

const base: AddDocumentFormProps = { employeeId: "e1", employeeName: "Noura Test", companyName: "Enginious Local AE", countryCode: "AE", allowedStores: ["identity", "employee"], closeHref: "/employees/e1?tab=documents", defaultOpen: true };
beforeEach(() => {
  mocks.addDocument.mockReset().mockResolvedValue({ error: null, saved: { id: "d1", label: "Emirates ID", existing: false } });
  mocks.prepareDocumentUpload.mockReset().mockResolvedValue({ error: null, bucket: "identity-documents", path: "c/e/emirates_id/s-eid.pdf", token: "tok" });
  mocks.uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
});
afterEach(cleanup);
const choose = (key: string) => fireEvent.change(screen.getByTestId("add-document-type"), { target: { value: key } });

describe("AddDocumentForm", () => {
  it("shows the employee and company at the top and no fields until a type is chosen", () => {
    render(<AddDocumentForm {...base} />);
    expect(screen.getByTestId("add-document-context").textContent).toContain("Noura Test");
    expect(screen.getByTestId("add-document-context").textContent).toContain("Enginious Local AE");
    expect(screen.queryByTestId("add-document-number")).toBeNull();
    expect((screen.getByTestId("add-document-submit") as HTMLButtonElement).disabled).toBe(true);
  });
  it("offers the types usual for the country first", () => {
    render(<AddDocumentForm {...base} countryCode="SA" />);
    const groups = [...screen.getByTestId("add-document-type").querySelectorAll("optgroup")];
    expect(groups[0]!.label).toBe("Usual for SA");
    expect([...groups[0]!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Iqama", "Visa"]);
    expect(groups[1]!.label).toBe("Other types");
  });
  it("an identity type asks for a number (required), a scan (optional) and an expiry date", () => {
    render(<AddDocumentForm {...base} />);
    choose("identity:passport");
    expect(screen.getByTestId("add-document-number")).toBeTruthy();
    expect(screen.getByText(/Scan/).textContent).toContain("Optional");
    expect(screen.getByText(/Expiry date/).textContent).toContain("Required");
  });
  it("a visa asks for a file (required) and no number", () => {
    render(<AddDocumentForm {...base} />);
    choose("employee:visa");
    expect(screen.queryByTestId("add-document-number")).toBeNull();
    expect(screen.getByText(/^File/).textContent).toContain("Required");
    expect(screen.getByTestId("add-document-effect").textContent).toMatch(/Adds a Visa to Noura Test's file; the expiry date is tracked/);
  });
  it("a type that does not expire hides the expiry date and says so", () => {
    render(<AddDocumentForm {...base} countryCode="PL" />);
    choose("identity:pesel");
    expect(screen.queryByTestId("add-document-expiry")).toBeNull();
    expect(screen.getByTestId("add-document-no-expiry").textContent).toMatch(/does not expire/);
    expect(screen.getByTestId("add-document-effect").textContent).toMatch(/does not expire/);
  });
  it("shows the missing field's sentence beside that field and does not submit", () => {
    render(<AddDocumentForm {...base} />);
    choose("identity:passport");
    fireEvent.submit(screen.getByTestId("add-document-submit").closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Enter the Passport number.");
    expect(screen.getByTestId("add-document-number").getAttribute("aria-invalid")).toBe("true");
  });
  it("renewal locks the type, says the earlier document stays, and fills the earlier number", () => {
    render(<AddDocumentForm {...base} initialTypeKey="identity:passport" renew renewsDocumentId="d1" previousNumber="P-111" />);
    expect(screen.getByTestId("add-document-type-locked").textContent).toBe("Passport");
    expect(screen.queryByTestId("add-document-type")).toBeNull();
    expect(screen.getByText(/the earlier one stays in the history/)).toBeTruthy();
    expect((screen.getByTestId("add-document-number") as HTMLInputElement).value).toBe("P-111");
  });
  it("is one button until opened, and offers nothing to a viewer who may add no type", () => {
    const { container, rerender } = render(<AddDocumentForm {...base} defaultOpen={false} />);
    expect(screen.queryByTestId("add-document-form")).toBeNull();
    fireEvent.click(screen.getByTestId("add-document-open"));
    expect(screen.getByTestId("add-document-form")).toBeTruthy();
    rerender(<AddDocumentForm {...base} allowedStores={[]} />);
    expect(container.textContent).toBe("");
  });
  it("Escape closes the form", () => {
    render(<AddDocumentForm {...base} defaultOpen={false} />);
    fireEvent.click(screen.getByTestId("add-document-open"));
    fireEvent.keyDown(screen.getByTestId("add-document-form"), { key: "Escape" });
    expect(screen.queryByTestId("add-document-form")).toBeNull();
  });
});

describe("AddDocumentForm: the file goes straight to private storage, never through the server action", () => {
  const MB2 = 2 * 1024 * 1024;
  const pdf = (name = "eid.pdf", size = MB2, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });
  function fill(file: File | null) {
    render(<AddDocumentForm {...base} />);
    choose("identity:emirates_id");
    fireEvent.change(screen.getByTestId("add-document-number"), { target: { value: "784-1111-1111111-1" } });
    fireEvent.change(screen.getByTestId("add-document-expiry"), { target: { value: "2031-01-01" } });
    if (file) fireEvent.change(screen.getByTestId("add-document-file"), { target: { files: [file] } });
  }
  const submit = async () => { await act(async () => { fireEvent.submit(screen.getByTestId("add-document-submit").closest("form")!); }); };

  it("says the limit in the same words the server enforces", () => {
    fill(null);
    expect(screen.getByText("PDF, JPEG, PNG or WebP, up to 10 MB.")).toBeTruthy();
  });
  it("a 2 MB PDF: asks the server to prepare it, sends the bytes to private storage, then saves with only the file's name, type and size", async () => {
    const file = pdf();
    fill(file);
    await submit();
    await waitFor(() => expect(mocks.addDocument).toHaveBeenCalled());
    expect(mocks.prepareDocumentUpload).toHaveBeenCalledWith(expect.objectContaining({ employeeId: "e1", typeKey: "identity:emirates_id", name: "eid.pdf", size: MB2, type: "application/pdf" }));
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith("c/e/emirates_id/s-eid.pdf", "tok", file, { contentType: "application/pdf" });
    expect(mocks.prepareDocumentUpload.mock.invocationCallOrder[0]).toBeLessThan(mocks.uploadToSignedUrl.mock.invocationCallOrder[0]!);
    expect(mocks.uploadToSignedUrl.mock.invocationCallOrder[0]).toBeLessThan(mocks.addDocument.mock.invocationCallOrder[0]!);
    const sent = mocks.addDocument.mock.calls[0]![1] as FormData;
    expect(sent.get("file")).toBeNull();
    expect(sent.get("fileName")).toBe("eid.pdf");
    expect(sent.get("fileType")).toBe("application/pdf");
    expect(sent.get("fileSize")).toBe(String(MB2));
    expect(sent.get("number")).toBe("784-1111-1111111-1");
    expect(screen.getByTestId("add-document-saved")).toBeTruthy();
  });
  it("a file over 10 MB is refused beside the field, inline, before anything is sent", async () => {
    fill(pdf("big.pdf", 10 * 1024 * 1024 + 1));
    await submit();
    expect(screen.getByRole("alert").textContent).toMatch(/too large/);
    expect(mocks.prepareDocumentUpload).not.toHaveBeenCalled();
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(mocks.addDocument).not.toHaveBeenCalled();
  });
  it("a file of the wrong type is refused inline before anything is sent", async () => {
    fill(pdf("letter.docx", 1000, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    await submit();
    expect(screen.getByRole("alert").textContent).toMatch(/Only PDF, JPEG, PNG, or WebP/);
    expect(mocks.prepareDocumentUpload).not.toHaveBeenCalled();
  });
  it("shows the server's refusal inline and saves nothing", async () => {
    mocks.prepareDocumentUpload.mockResolvedValue({ error: "Only an HR Admin of this employee's company can add documents." });
    fill(pdf());
    await submit();
    expect(screen.getByRole("alert").textContent).toMatch(/Only an HR Admin/);
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(mocks.addDocument).not.toHaveBeenCalled();
  });
  it("shows an upload failure inline, saves nothing, and a retry sends the SAME submission id so it cannot add twice", async () => {
    mocks.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "network" } });
    fill(pdf());
    await submit();
    expect(screen.getByRole("alert").textContent).toMatch(/could not be uploaded/);
    expect(mocks.addDocument).not.toHaveBeenCalled();
    await submit();
    await waitFor(() => expect(mocks.addDocument).toHaveBeenCalledTimes(1));
    const [first, second] = mocks.prepareDocumentUpload.mock.calls.map((c) => (c[0] as { submissionId: string }).submissionId);
    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect((mocks.addDocument.mock.calls[0]![1] as FormData).get("submissionId")).toBe(first);
  });
  it("skips the upload when the server says the file is already stored (a retry after a lost answer)", async () => {
    mocks.prepareDocumentUpload.mockResolvedValue({ error: null, bucket: "identity-documents", path: "c/e/emirates_id/s-eid.pdf", token: null });
    fill(pdf());
    await submit();
    await waitFor(() => expect(mocks.addDocument).toHaveBeenCalled());
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });
  it("saves an identity number with no file without touching storage", async () => {
    fill(null);
    await submit();
    await waitFor(() => expect(mocks.addDocument).toHaveBeenCalled());
    expect(mocks.prepareDocumentUpload).not.toHaveBeenCalled();
    expect((mocks.addDocument.mock.calls[0]![1] as FormData).get("fileName")).toBeNull();
  });
});
