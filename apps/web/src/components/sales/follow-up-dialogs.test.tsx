/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/sales/follow-ups", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/workspace/unsaved", () => ({ useUnsavedChanges: () => undefined }));
const rescheduleFollowUp = vi.fn();
const completeFollowUp = vi.fn();
const cancelFollowUp = vi.fn();
vi.mock("@/lib/actions/crm", () => ({
  rescheduleFollowUp: (...a: unknown[]) => rescheduleFollowUp(...a), completeFollowUp: (...a: unknown[]) => completeFollowUp(...a),
  cancelFollowUp: (...a: unknown[]) => cancelFollowUp(...a), createFollowUp: vi.fn(),
}));

import { CompleteFollowUpDialog, RescheduleFollowUpDialog, type FollowUpRef } from "./follow-up-dialogs";
import { FollowUpRowActions } from "./follow-up-row-actions";

// jsdom has no <dialog> methods.
HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); };
HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.removeAttribute("open"); };

// Fictional data only. Monday 9 Nov 2026, 10:00 in Dubai; the follow-up was due on the 6th at 15:30 Dubai time.
const followUp: FollowUpRef = { id: "f1", title: "Call the fictional agency", kind: "meeting", dueAt: "2026-11-06T11:30:00Z", opportunityId: "o1", isOnlyOpen: false, timeZone: "Asia/Dubai" };
const posted = (fn: ReturnType<typeof vi.fn>) => Object.fromEntries((fn.mock.calls[0]![1] as FormData).entries());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T06:00:00Z"));
  rescheduleFollowUp.mockReset().mockResolvedValue({ error: null });
  completeFollowUp.mockReset().mockResolvedValue({ error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Reschedule", () => {
  it("a shortcut fills the date, keeps the follow-up's own time, and SHOWS the resulting date and time before anything is saved", () => {
    render(<RescheduleFollowUpDialog open onClose={() => undefined} followUp={followUp} />);
    expect(screen.getByText(/Fri, 6 Nov 2026, 15:30/)).toBeTruthy(); // what it is moving from
    expect(screen.getByTestId("when-result").textContent).toMatch(/Choose a date/);
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect((screen.getByLabelText("New date") as HTMLInputElement).value).toBe("2026-11-10");
    expect((screen.getByLabelText("Time (Dubai)") as HTMLInputElement).value).toBe("15:30");
    expect(screen.getByTestId("when-result").textContent).toBe("New due date Tue, 10 Nov 2026, 15:30 (Dubai time)");
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByTestId("when-result").textContent).toContain("Mon, 16 Nov 2026, 15:30");
    expect(screen.getByRole("button", { name: "Next week" }).getAttribute("aria-pressed")).toBe("true");
    expect(rescheduleFollowUp).not.toHaveBeenCalled();
  });

  it("saves exactly what was shown, and the time can still be changed by hand (the preview follows)", async () => {
    const onClose = vi.fn();
    render(<RescheduleFollowUpDialog open onClose={onClose} followUp={followUp} />);
    fireEvent.click(screen.getByRole("button", { name: "In 2 days" }));
    fireEvent.change(screen.getByLabelText("Time (Dubai)"), { target: { value: "09:15" } });
    expect(screen.getByTestId("when-result").textContent).toContain("Wed, 11 Nov 2026, 09:15");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posted(rescheduleFollowUp)).toMatchObject({ followUpId: "f1", opportunityId: "o1", date: "2026-11-11", time: "09:15" });
  });

  it("a time that has already passed is said before saving, and a refused save keeps what was chosen", async () => {
    rescheduleFollowUp.mockResolvedValue({ error: "This follow-up is already closed" });
    render(<RescheduleFollowUpDialog open onClose={() => undefined} followUp={followUp} />);
    fireEvent.change(screen.getByLabelText("New date"), { target: { value: "2026-11-09" } });
    fireEvent.change(screen.getByLabelText("Time (Dubai)"), { target: { value: "08:00" } });
    expect(screen.getByTestId("when-result").textContent).toContain("already passed");
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already closed"));
    expect((screen.getByLabelText("New date") as HTMLInputElement).value).toBe("2026-11-09");
  });
});

describe("Complete", () => {
  it("the next action starts on the same type as the follow-up being completed, at 10:00, with the same shortcuts and preview", async () => {
    const onClose = vi.fn();
    render(<CompleteFollowUpDialog open onClose={onClose} followUp={{ ...followUp, isOnlyOpen: true }} />);
    // The only next action of an open enquiry: the rule stays visible and "nothing more" is not offered.
    expect(screen.getByText("What happens next? (required, this was the last follow-up)")).toBeTruthy();
    expect(screen.queryByLabelText(/Nothing more now/)).toBeNull();
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("meeting");
    expect((screen.getByLabelText("Time (Dubai)") as HTMLInputElement).value).toBe("10:00");
    fireEvent.change(screen.getByLabelText("What happened?"), { target: { value: "Met them; they want a revised plan." } });
    fireEvent.change(screen.getByLabelText("Next action"), { target: { value: "Send the revised plan" } });
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(screen.getByTestId("when-result").textContent).toBe("Will be due Tue, 10 Nov 2026, 10:00 (Dubai time)");
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posted(completeFollowUp)).toMatchObject({ followUpId: "f1", next: "follow_up", nextTitle: "Send the revised plan", nextDate: "2026-11-10", nextTime: "10:00", nextKind: "meeting" });
  });

  it("a follow-up with no known type still defaults to Other", () => {
    render(<CompleteFollowUpDialog open onClose={() => undefined} followUp={{ id: "f2", title: "Chase", opportunityId: "o1", isOnlyOpen: true, timeZone: "Asia/Dubai" }} />);
    expect((screen.getByLabelText("Type") as HTMLSelectElement).value).toBe("other");
  });
});

describe("the actions on a row", () => {
  it("Complete is the main action and Reschedule is one tap away beside it, not inside the menu", () => {
    render(<FollowUpRowActions followUp={followUp} />);
    expect(screen.getByRole("button", { name: "Complete follow-up: Call the fictional agency" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reschedule follow-up: Call the fictional agency" }));
    expect(within(screen.getByRole("dialog")).getByLabelText("New date")).toBeTruthy();
  });

  it("the only next action of an open enquiry cannot be cancelled: the item is switched off and says why", () => {
    render(<FollowUpRowActions followUp={{ ...followUp, isOnlyOpen: true }} />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    const item = screen.getByRole("menuitem", { name: /Cancel follow-up/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.textContent).toContain("only next action");
    fireEvent.click(item);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("another follow-up exists: Cancel opens its dialog, with the rule behind the ⓘ instead of a paragraph", () => {
    render(<FollowUpRowActions followUp={followUp} />);
    fireEvent.click(screen.getByRole("button", { name: /More/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Cancel follow-up/ }));
    const d = screen.getByRole("dialog");
    expect(within(d).getByLabelText("Why is it no longer needed?")).toBeTruthy();
    expect(d.textContent).not.toContain("cannot be cancelled");
  });
});
