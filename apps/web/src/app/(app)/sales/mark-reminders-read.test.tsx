/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const markRemindersRead = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ markRemindersRead: (...a: unknown[]) => markRemindersRead(...a) }));

import { MarkRemindersReadButton } from "./mark-reminders-read";

afterEach(() => { cleanup(); markRemindersRead.mockReset(); });

describe("dismissing a reminder", () => {
  it("sends every row behind the one reminder shown for the follow-up", async () => {
    markRemindersRead.mockResolvedValue({ error: null, marked: 2, failed: 0 });
    render(<MarkRemindersReadButton reminderIds={["r-due", "r-over"]} label="Dismiss" about="Call the fictional agency" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss: Call the fictional agency" }));
    await waitFor(() => expect(markRemindersRead).toHaveBeenCalledWith(["r-due", "r-over"]));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("'Mark all read' sends no ids (all of the person's reminders)", async () => {
    markRemindersRead.mockResolvedValue({ error: null, marked: 5, failed: 0 });
    render(<MarkRemindersReadButton />);
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(markRemindersRead).toHaveBeenCalledWith(undefined));
  });

  it("a partial or total failure is shown beside the button, also when the server cannot be reached", async () => {
    markRemindersRead.mockResolvedValue({ error: "Only partly dismissed: 1 of 2 reminder records were marked read. Try again to clear the rest.", marked: 1, failed: 1 });
    render(<MarkRemindersReadButton reminderIds={["a", "b"]} label="Dismiss" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Only partly dismissed: 1 of 2"));
    markRemindersRead.mockRejectedValue(new Error("network"));
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" })); // the button comes back once the first attempt has finished
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Could not reach the server"));
  });
});
