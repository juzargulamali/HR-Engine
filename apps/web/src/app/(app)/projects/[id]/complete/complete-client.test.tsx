// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/lib/actions/projectsClose", () => ({ completeProject: vi.fn(async () => ({ error: null })) }));

import { CompleteClient } from "./complete-client";
import { completionLoadProblems, completionReadState } from "./complete-helpers";

afterEach(() => { cleanup(); refresh.mockClear(); });
const base = { projectId: "p1", projectKind: "internal" as const, items: [], evidenceFiles: [], today: "2026-11-11" };
const submit = () => screen.getByRole("button", { name: "Complete project" }) as HTMLButtonElement;
const note = () => fireEvent.change(document.getElementById("ev-note") as HTMLTextAreaElement, { target: { value: "Delivered as agreed." } });

describe("completing a project when a read fails", () => {
  it("a successful EMPTY review says nothing is unfinished and lets the owner complete once the note is written", () => {
    render(<CompleteClient {...base} />);
    expect(screen.getByText(/Nothing is unfinished/)).toBeTruthy();
    expect(screen.queryByTestId("completion-review-failed")).toBeNull();
    expect(submit().disabled).toBe(true);
    note();
    expect(submit().disabled).toBe(false);
  });
  it("a FAILED review names what could not load, offers Retry and keeps confirmation off even when everything else is filled in", () => {
    render(<CompleteClient {...base} reviewFailed />);
    expect(screen.getByTestId("completion-review-failed").textContent).toMatch(/Could not load the unfinished work/);
    expect(screen.queryByText(/Nothing is unfinished: no open tasks/)).toBeNull();
    note();
    expect(submit().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/unfinished work of this project .* could not load/);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refresh).toHaveBeenCalledTimes(1);                                         // reads again without leaving the page
  });
  it("a failed evidence read blocks a CLIENT project (not 'none uploaded') and offers Retry; an internal project does not depend on it", () => {
    const { unmount } = render(<CompleteClient {...base} projectKind="client" evidenceFailed />);
    expect(screen.getByTestId("completion-evidence-failed").textContent).toMatch(/Could not load the uploaded completion evidence/);
    expect(screen.queryByText("No completion evidence uploaded yet")).toBeNull();
    expect(submit().disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBe(1);
    unmount();
    render(<CompleteClient {...base} evidenceFailed />);
    note();
    expect(submit().disabled).toBe(false);
  });
  it("a successful empty evidence list is shown as 'none uploaded yet', not as an error", () => {
    render(<CompleteClient {...base} projectKind="client" />);
    fireEvent.change(screen.getByLabelText("Kind of confirmation"), { target: { value: "uploaded_confirmation" } });
    expect(screen.getByText("No completion evidence uploaded yet")).toBeTruthy();
    expect(screen.queryByTestId("completion-evidence-failed")).toBeNull();
  });
});

describe("what a completion read's error means", () => {
  it("tells a refusal from a failure from success", () => {
    expect(completionReadState(null)).toBe("ok");
    expect(completionReadState({ code: "42501", message: "permission denied for function" })).toBe("denied");
    expect(completionReadState({ code: "P0002", message: "Project not found" })).toBe("denied");
    expect(completionReadState({ message: "the data service did not answer" })).toBe("failed");
    expect(completionReadState({ code: "57014", message: "canceling statement due to statement timeout" })).toBe("failed");
  });
  it("lists only the information that is required and did not load", () => {
    expect(completionLoadProblems({ reviewFailed: false, evidenceFailed: false, projectKind: "client" })).toEqual([]);
    expect(completionLoadProblems({ reviewFailed: true, evidenceFailed: true, projectKind: "client" })).toHaveLength(2);
    expect(completionLoadProblems({ reviewFailed: false, evidenceFailed: true, projectKind: "internal" })).toEqual([]);
  });
});
