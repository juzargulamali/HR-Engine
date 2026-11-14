/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const addProposal = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ addProposal: (...a: unknown[]) => addProposal(...a), setProposalStatus: vi.fn() }));
const prepareCrmUpload = vi.fn();
const finalizeCrmUpload = vi.fn();
vi.mock("@/lib/actions/crmFiles", () => ({ prepareCrmUpload: (...a: unknown[]) => prepareCrmUpload(...a), finalizeCrmUpload: (...a: unknown[]) => finalizeCrmUpload(...a) }));
const uploadToSignedUrl = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl: (...a: unknown[]) => uploadToSignedUrl(...a) }) } }) }));

import { AddProposalForm } from "./proposal-forms";

const FILE_ID = "55555555-5555-4555-8555-555555555555";
afterEach(() => { cleanup(); for (const m of [addProposal, prepareCrmUpload, finalizeCrmUpload, uploadToSignedUrl, refresh]) m.mockReset(); });
const ready = () => {
  prepareCrmUpload.mockResolvedValue({ error: null, intentId: "i1", path: "q/p.pdf", token: "t" });
  uploadToSignedUrl.mockResolvedValue({ error: null });
  finalizeCrmUpload.mockResolvedValue({ error: null, fileId: FILE_ID });
};
// Fictional file only.
const pdf = () => new File(["%PDF-1.7 fictional"], "Fictional proposal v2.pdf", { type: "application/pdf" });
const choose = (file: File) => fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
const fileIdOf = (call: unknown[]) => (call[1] as FormData).get("fileId");

describe("Add proposal version: upload the document or reuse one, in the same form", () => {
  it("uploads the chosen file through the shared private upload, then adds the version with that file", async () => {
    ready();
    addProposal.mockResolvedValue({ error: null });
    render(<AddProposalForm opportunityId="o1" nextVersion={2} files={[]} />);
    fireEvent.change(screen.getByLabelText("What changed"), { target: { value: "Added the second wall" } });
    choose(pdf());
    fireEvent.click(screen.getByRole("button", { name: "Add version 2 as a draft" }));
    await waitFor(() => expect(screen.getByText("Version 2 was added as a draft.")).toBeTruthy());
    expect(prepareCrmUpload).toHaveBeenCalledWith(expect.objectContaining({ opportunityId: "o1", name: "Fictional proposal v2.pdf", type: "application/pdf", purpose: "proposal" }));
    expect(finalizeCrmUpload).toHaveBeenCalledWith("i1");
    expect(fileIdOf(addProposal.mock.calls[0]!)).toBe(FILE_ID);
    expect((addProposal.mock.calls[0]![1] as FormData).get("note")).toBe("Added the second wall");
  });

  it("the file went up but the version did not: it says so, keeps the file, and Retry adds the version with the SAME file without uploading again", async () => {
    ready();
    addProposal.mockResolvedValueOnce({ error: "Someone else changed this enquiry. Reload and try again." }).mockResolvedValueOnce({ error: null });
    render(<AddProposalForm opportunityId="o1" nextVersion={3} files={[]} />);
    choose(pdf());
    fireEvent.click(screen.getByRole("button", { name: "Add version 3 as a draft" }));
    await waitFor(() => expect(screen.getByText("The file was uploaded. Adding the version did not finish.")).toBeTruthy());
    expect(screen.getByText("Someone else changed this enquiry. Reload and try again.")).toBeTruthy();
    expect(screen.getByTestId("pv-uploaded").textContent).toContain("Fictional proposal v2.pdf");
    fireEvent.click(screen.getByRole("button", { name: "Retry adding version 3" }));
    await waitFor(() => expect(screen.getByText("Version 3 was added as a draft.")).toBeTruthy());
    expect(prepareCrmUpload).toHaveBeenCalledTimes(1);
    expect(uploadToSignedUrl).toHaveBeenCalledTimes(1);
    expect(finalizeCrmUpload).toHaveBeenCalledTimes(1);
    expect(addProposal).toHaveBeenCalledTimes(2);
    expect(addProposal.mock.calls.map(fileIdOf)).toEqual([FILE_ID, FILE_ID]);
    expect(screen.queryByText("The file was uploaded. Adding the version did not finish.")).toBeNull();
  });

  it("a rejected file keeps its reason on screen and nothing is added", async () => {
    render(<AddProposalForm opportunityId="o1" nextVersion={1} files={[]} />);
    choose(new File(["MZ fictional"], "setup.exe", { type: "application/octet-stream" }));
    fireEvent.click(screen.getByRole("button", { name: "Add version 1 as a draft" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/cannot be uploaded/));
    expect(prepareCrmUpload).not.toHaveBeenCalled();
    expect(addProposal).not.toHaveBeenCalled();
    prepareCrmUpload.mockResolvedValue({ error: null, intentId: "i1", path: "q/p.pdf", token: "t" });
    uploadToSignedUrl.mockResolvedValue({ error: null });
    finalizeCrmUpload.mockResolvedValue({ error: "The file's contents do not match its type." });
    choose(pdf());
    fireEvent.click(screen.getByRole("button", { name: "Add version 1 as a draft" }));
    await waitFor(() => expect(screen.getByText("The file's contents do not match its type.")).toBeTruthy());
    expect(addProposal).not.toHaveBeenCalled();
  });

  it("an existing file is reused without any upload; the restrictions sit behind one ⓘ", async () => {
    addProposal.mockResolvedValue({ error: null });
    render(<AddProposalForm opportunityId="o1" nextVersion={2} files={[{ id: FILE_ID, label: "Fictional deck.pdf" }]} />);
    expect(screen.getAllByRole("button", { name: "More information" })).toHaveLength(1);
    expect(screen.queryByText(/up to 20 MB/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Use a file already added"));
    fireEvent.click(screen.getByRole("button", { name: "Add version 2 as a draft" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Choose one of the files already added/));
    fireEvent.change(screen.getByLabelText("File or link already added"), { target: { value: FILE_ID } });
    fireEvent.click(screen.getByRole("button", { name: "Add version 2 as a draft" }));
    await waitFor(() => expect(addProposal).toHaveBeenCalledTimes(1));
    expect(fileIdOf(addProposal.mock.calls[0]!)).toBe(FILE_ID);
    expect(prepareCrmUpload).not.toHaveBeenCalled();
  });

  it("a version can still be added with no document", async () => {
    addProposal.mockResolvedValue({ error: null });
    render(<AddProposalForm opportunityId="o1" nextVersion={1} files={[]} />);
    fireEvent.click(screen.getByLabelText("No document yet"));
    fireEvent.click(screen.getByRole("button", { name: "Add version 1 as a draft" }));
    await waitFor(() => expect(addProposal).toHaveBeenCalledTimes(1));
    expect(fileIdOf(addProposal.mock.calls[0]!)).toBeNull();
  });
});
