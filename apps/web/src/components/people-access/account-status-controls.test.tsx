/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseHoldings } from "@/lib/people-access/holdings";

const actions = vi.hoisted(() => ({
  deactivateAccount: vi.fn(), reactivateAccount: vi.fn(), getAccountHoldings: vi.fn(), adminSendPasswordReset: vi.fn(), checkAccountStatusConsistency: vi.fn(),
}));
vi.mock("@/lib/actions/account-status", () => actions);

import { AccountStatusControls } from "./account-status-controls";

const EMPTY = { blockers: [], pending_approvals: [], projects_managed: [], projects_acting: [], teams_headed: [], roles: [], module_access: [], equipment_held: 0 };
const holdings = (over: Record<string, unknown> = {}) => ({ holdings: parseHoldings({ ...EMPTY, ...over }), error: null });

beforeEach(() => {
  for (const a of Object.values(actions)) a.mockReset();
  actions.deactivateAccount.mockResolvedValue({ error: null });
  actions.reactivateAccount.mockResolvedValue({ error: null });
  vi.spyOn(window, "prompt").mockImplementation(() => { throw new Error("a browser dialog must not be used"); });
});
afterEach(() => cleanup());

describe("Deactivate: what the person still holds, and a reason in the page", () => {
  it("shows what the person still holds before the reason, says pending approvals are not re-routed, and uses no browser dialog", async () => {
    actions.getAccountHoldings.mockResolvedValue(holdings({ pending_approvals: [{ entity_type: "leave_request", count: 2 }], projects_managed: [{ reference: "UAE-P-0001" }], equipment_held: 1 }));
    render(<AccountStatusControls userId="u1" status="active" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText(/2 approvals waiting on this person/)).toBeTruthy();
    expect(screen.getByText(/nothing is re-routed automatically/)).toBeTruthy();
    expect(screen.getByText(/Project Manager of 1 live project: UAE-P-0001/)).toBeTruthy();
    expect(screen.getByText(/1 item of equipment issued to this person/)).toBeTruthy();
    expect(actions.getAccountHoldings).toHaveBeenCalledWith("u1");
    expect(window.prompt).not.toHaveBeenCalled();
  });

  it("will not confirm without a reason; confirming sends the typed reason and closes the panel", async () => {
    actions.getAccountHoldings.mockResolvedValue(holdings());
    render(<AccountStatusControls userId="u1" status="active" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    const confirm = (await screen.findByRole("button", { name: "Deactivate account" })) as HTMLButtonElement;
    await waitFor(() => expect(screen.queryByText(/Checking what this person still holds/)).toBeNull());
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "  Left the company  " } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(actions.deactivateAccount).toHaveBeenCalledWith("u1", "Left the company"));
    await waitFor(() => expect(screen.queryByRole("group")).toBeNull());
  });

  it("a person who cannot be deactivated shows why and the Deactivate account button stays disabled", async () => {
    actions.getAccountHoldings.mockResolvedValue(holdings({ blockers: ["Can't deactivate the only CEO or CTO of Enginious KSA — give another active person that role first"] }));
    render(<AccountStatusControls userId="u1" status="active" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText(/only CEO or CTO of Enginious KSA/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Left" } });
    expect((screen.getByRole("button", { name: "Deactivate account" }) as HTMLButtonElement).disabled).toBe(true);
    expect(actions.deactivateAccount).not.toHaveBeenCalled();
  });

  it("a failed check says so and offers a retry; it never lets the person be deactivated on a half-read", async () => {
    actions.getAccountHoldings.mockResolvedValueOnce({ holdings: null, error: "Couldn't check what this account still holds. Try again before deactivating." });
    render(<AccountStatusControls userId="u1" status="active" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText(/Couldn't check what this account still holds/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Left" } });
    expect((screen.getByRole("button", { name: "Deactivate account" }) as HTMLButtonElement).disabled).toBe(true);
    actions.getAccountHoldings.mockResolvedValueOnce(holdings());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Deactivate account" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("shows the database's own refusal when the deactivation fails, and keeps the panel open with the reason typed", async () => {
    actions.getAccountHoldings.mockResolvedValue(holdings());
    actions.deactivateAccount.mockResolvedValue({ error: "Can't deactivate the last active System Administrator" });
    render(<AccountStatusControls userId="u1" status="active" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.queryByText(/Checking what this person still holds/)).toBeNull());
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: "Left" } });
    fireEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    expect(await screen.findByText(/last active System Administrator/)).toBeTruthy();
    expect((screen.getByLabelText(/Reason/) as HTMLTextAreaElement).value).toBe("Left");
  });

  it("Cancel closes the panel and sends nothing", async () => {
    actions.getAccountHoldings.mockResolvedValue(holdings());
    render(<AccountStatusControls userId="u1" status="active" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group")).toBeNull();
    expect(actions.deactivateAccount).not.toHaveBeenCalled();
  });
});

describe("Reactivate and your own account", () => {
  it("reactivating asks for a reason in the page too, and does not look up holdings", async () => {
    render(<AccountStatusControls userId="u1" status="deactivated" isSelf={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Reactivate" }));
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Returned" } });
    fireEvent.click(screen.getByRole("button", { name: "Reactivate account" }));
    await waitFor(() => expect(actions.reactivateAccount).toHaveBeenCalledWith("u1", "Returned"));
    expect(actions.getAccountHoldings).not.toHaveBeenCalled();
  });

  it("your own account offers no status change", () => {
    render(<AccountStatusControls userId="u1" status="active" isSelf />);
    expect(screen.queryByRole("button", { name: "Deactivate" })).toBeNull();
    expect(screen.getByText(/can.t change your own account status/i)).toBeTruthy();
  });
});
