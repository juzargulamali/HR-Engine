/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ attachIdentityFile: vi.fn(), prepareIdentityFileUpload: vi.fn(), uploadToSignedUrl: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/employeeDocuments", () => ({ attachIdentityFile: mocks.attachIdentityFile, prepareIdentityFileUpload: mocks.prepareIdentityFileUpload }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.uploadToSignedUrl }) } }) }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/actions/employees", () => ({ deleteIdentityDocument: vi.fn(), deleteEmployeeDocument: vi.fn(), restoreEmployeeDocument: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: mocks.refresh }) }));

import { AttachIdentityFile } from "./attach-identity-file";
import { DocumentsList } from "./documents-list";
import type { DocumentRow } from "./documents-data";

const D = "doc-1";
const MB2 = 2 * 1024 * 1024;
const pdf = (name = "eid.pdf", size = MB2, type = "application/pdf") => new File([new Uint8Array(size)], name, { type });
const open = () => fireEvent.click(screen.getByTestId(`attach-file-open-${D}`));
const choose = (file: File) => fireEvent.change(screen.getByTestId(`attach-file-input-${D}`), { target: { files: [file] } });
const attach = async () => { await act(async () => { fireEvent.click(screen.getByTestId(`attach-file-submit-${D}`)); }); };

beforeEach(() => {
  mocks.prepareIdentityFileUpload.mockReset().mockResolvedValue({ error: null, bucket: "identity-documents", path: "c/e/emirates_id/s-eid.pdf", token: "tok" });
  mocks.attachIdentityFile.mockReset().mockResolvedValue({ error: null, attached: true });
  mocks.uploadToSignedUrl.mockReset().mockResolvedValue({ error: null });
  mocks.refresh.mockReset();
});
afterEach(cleanup);

describe("AttachIdentityFile", () => {
  it("is one button until opened, then says the limit and that the number and dates stay", () => {
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    expect(screen.queryByTestId(`attach-file-form-${D}`)).toBeNull();
    open();
    expect(screen.getByText(/PDF, JPEG, PNG or WebP, up to 10 MB\. The number and dates stay as they are\./)).toBeTruthy();
  });
  it("sends the 2 MB file to private storage, attaches it to that same document by id, and refreshes the list", async () => {
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    open();
    const file = pdf();
    choose(file);
    await attach();
    await waitFor(() => expect(mocks.attachIdentityFile).toHaveBeenCalled());
    expect(mocks.prepareIdentityFileUpload).toHaveBeenCalledWith(expect.objectContaining({ documentId: D, name: "eid.pdf", size: MB2, type: "application/pdf" }));
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith("c/e/emirates_id/s-eid.pdf", "tok", file, { contentType: "application/pdf" });
    expect(mocks.attachIdentityFile).toHaveBeenCalledWith(expect.objectContaining({ documentId: D, name: "eid.pdf", size: MB2, type: "application/pdf" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });
  it("asks for a file when none is chosen", async () => {
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    open();
    await attach();
    expect(screen.getByTestId(`attach-file-error-${D}`).textContent).toBe("Choose the file to attach.");
    expect(mocks.prepareIdentityFileUpload).not.toHaveBeenCalled();
  });
  it("refuses an oversize or wrong-type file inline before anything is sent", async () => {
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    open();
    choose(pdf("big.pdf", 10 * 1024 * 1024 + 1));
    await attach();
    expect(screen.getByTestId(`attach-file-error-${D}`).textContent).toMatch(/too large/);
    choose(pdf("a.docx", 100, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    await attach();
    expect(screen.getByTestId(`attach-file-error-${D}`).textContent).toMatch(/Only PDF/);
    expect(mocks.prepareIdentityFileUpload).not.toHaveBeenCalled();
  });
  it("shows the server's refusal inline and does not refresh", async () => {
    mocks.prepareIdentityFileUpload.mockResolvedValue({ error: "Only an HR Admin of this employee's company can attach a file to this document." });
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    open();
    choose(pdf());
    await attach();
    expect(screen.getByTestId(`attach-file-error-${D}`).textContent).toMatch(/Only an HR Admin/);
    expect(mocks.attachIdentityFile).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("shows an upload failure inline; the retry reuses the same submission id, so it cannot attach twice", async () => {
    mocks.uploadToSignedUrl.mockResolvedValueOnce({ error: { message: "network" } });
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    open();
    choose(pdf());
    await attach();
    expect(screen.getByTestId(`attach-file-error-${D}`).textContent).toMatch(/could not be uploaded/);
    await attach();
    await waitFor(() => expect(mocks.attachIdentityFile).toHaveBeenCalledTimes(1));
    const ids = mocks.prepareIdentityFileUpload.mock.calls.map((c) => (c[0] as { submissionId: string }).submissionId);
    expect(ids[1]).toBe(ids[0]);
  });
  it("shows the check's refusal inline (for example a file that failed the content check)", async () => {
    mocks.attachIdentityFile.mockResolvedValue({ error: "This does not look like a real PDF." });
    render(<AttachIdentityFile documentId={D} label="Emirates ID" />);
    open();
    choose(pdf());
    await attach();
    expect(screen.getByTestId(`attach-file-error-${D}`).textContent).toBe("This does not look like a real PDF.");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("DocumentsList: where Attach file appears", () => {
  const row = (over: Partial<DocumentRow>): DocumentRow => ({ id: D, store: "identity", storedType: "emirates_id", label: "Emirates ID", number: "784-1", expiryDate: "2031-05-01", state: "valid", trackedStatus: null, removed: false, url: null, urlFailed: false, createdAt: "2026-11-16T15:49:00Z", ...over });
  const list = (rows: DocumentRow[], canEditIdentity = true) => render(<DocumentsList employeeId="e1" rows={rows} canEditEmployeeDocuments canEditIdentity={canEditIdentity} />);

  it("is on an identity row that says 'No file attached', for an HR Admin", () => {
    list([row({})]);
    expect(screen.getByText("No file attached")).toBeTruthy();
    expect(screen.getByTestId(`attach-file-open-${D}`)).toBeTruthy();
  });
  it("is not on an identity row that has a file, one whose link failed, a removed row, an employee document, or for a viewer who cannot manage identity documents", () => {
    list([row({ url: "https://example.test/f" })]);
    expect(screen.queryByTestId(`attach-file-open-${D}`)).toBeNull();
    cleanup();
    list([row({ urlFailed: true })]);
    expect(screen.queryByTestId(`attach-file-open-${D}`)).toBeNull();
    cleanup();
    list([row({ removed: true })]);
    expect(screen.queryByTestId(`attach-file-open-${D}`)).toBeNull();
    cleanup();
    list([row({ store: "employee", storedType: "visa", label: "Visa" })]);
    expect(screen.queryByTestId(`attach-file-open-${D}`)).toBeNull();
    cleanup();
    list([row({})], false);
    expect(screen.queryByTestId(`attach-file-open-${D}`)).toBeNull();
  });
});
