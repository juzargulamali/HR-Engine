/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/projectsDelivery", () => ({
  blockProjectTask: vi.fn(), commentOnTask: vi.fn(), previewTaskDateChange: vi.fn(), reassignProjectTask: vi.fn(), setProjectTaskStatus: vi.fn(), unblockProjectTask: vi.fn(), updateProjectTask: vi.fn(),
}));

import { BlockForm } from "./task-forms";

afterEach(() => cleanup());
const members = [{ id: "pm", name: "Priya (PM)" }, { id: "lead", name: "Lee" }];

describe("reporting a blocker", () => {
  it("asks for the reason and the responsible person only, with the person pre-filled, required and editable", () => {
    render(<BlockForm projectId="p" taskId="t" members={members} defaultOwner="pm" />);
    expect(screen.getByLabelText("What is blocking it").hasAttribute("required")).toBe(true);
    const who = screen.getByLabelText("Who is responsible for unblocking it") as HTMLSelectElement;
    expect(who.value).toBe("pm");
    expect(who.required).toBe(true);
    expect(Array.from(who.options).map((o) => o.value)).toEqual(["pm", "lead"]);
    expect(screen.queryByLabelText(/Or what action/)).toBeNull();
    expect(screen.getByRole("button", { name: "Report blocker" })).toBeTruthy();
  });
  it("offers no pre-selected person when nobody fits, so one must be chosen", () => {
    render(<BlockForm projectId="p" taskId="t" members={members} defaultOwner="" />);
    const who = screen.getByLabelText("Who is responsible for unblocking it") as HTMLSelectElement;
    expect(who.value).toBe("");
    expect(who.required).toBe(true);
  });
});
