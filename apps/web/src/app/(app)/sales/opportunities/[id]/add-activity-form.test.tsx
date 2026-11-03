/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/crm", () => ({ addActivity: vi.fn() }));

import { AddActivityForm } from "./add-activity-form";

afterEach(() => cleanup());
const base = { opportunityId: "o1", suggestedDate: "2026-11-03", minDate: "2026-11-02" };

describe("Add update plans the next step in the same dialog", () => {
  it("starts with the next step off and the date suggested when it is turned on", () => {
    render(<AddActivityForm {...base} />);
    expect(screen.queryByLabelText("Next step")).toBeNull();
    fireEvent.click(screen.getByLabelText(/Plan the next step/));
    expect(screen.getByLabelText("Next step")).toBeTruthy();
    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-11-03");
    expect((screen.getByLabelText("Date") as HTMLInputElement).min).toBe("2026-11-02");
  });
  it("offers to complete a planned follow-up, and then the next step is required when it was the only one", () => {
    render(<AddActivityForm {...base} completable={[{ id: "f1", title: "Call Hana", isOnlyOpen: true }, { id: "f2", title: "Send deck", isOnlyOpen: false }]} />);
    fireEvent.change(screen.getByLabelText("This was one of the planned follow-ups"), { target: { value: "f1" } });
    expect(screen.getByRole("button", { name: "Complete and add to timeline" })).toBeTruthy();
    const plan = screen.getByLabelText(/Plan the next step/) as HTMLInputElement;
    expect(plan.checked).toBe(true);
    expect(plan.disabled).toBe(true);
    expect(screen.getByLabelText("Next step").hasAttribute("required")).toBe(true);
    fireEvent.change(screen.getByLabelText("This was one of the planned follow-ups"), { target: { value: "f2" } });
    expect((screen.getByLabelText(/Plan the next step/) as HTMLInputElement).disabled).toBe(false);
  });
  it("offers no completion choice when there is nothing open the person may complete", () => {
    render(<AddActivityForm {...base} />);
    expect(screen.queryByLabelText("This was one of the planned follow-ups")).toBeNull();
  });
});
