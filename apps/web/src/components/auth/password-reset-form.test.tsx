/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A fake of the one Supabase client the form talks to: what each call returns is set per test.
const supabase = vi.hoisted(() => {
  const state = { updateError: null as { message: string } | null, readStatus: "invited" as string | null, activationWrites: [] as unknown[], reads: 0 };
  const client = {
    auth: {
      setSession: vi.fn(async () => ({ error: null })),
      updateUser: vi.fn(async () => ({ data: { user: { id: "user-1" } }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    rpc: vi.fn(async () => ({ error: null })),
    from: vi.fn(),
  };
  const defaultFrom = () => ({
    update: (values: unknown) => ({ eq: async () => { state.activationWrites.push(values); return { error: state.updateError }; } }),
    select: () => ({ eq: () => ({ maybeSingle: async () => { state.reads += 1; return { data: state.readStatus === null ? null : { account_status: state.readStatus }, error: null }; } }) }),
  });
  return { state, client, defaultFrom };
});
vi.mock("@/lib/supabase/client", () => ({ createClient: () => supabase.client }));

import { PasswordResetForm } from "./password-reset-form";

const GOOD_PASSWORD = "First-Passw0rd!-1";
let navigatedTo: string | null;

beforeEach(() => {
  vi.useRealTimers();
  navigatedTo = null;
  supabase.state.updateError = null;
  supabase.state.readStatus = "active";
  supabase.state.activationWrites = [];
  supabase.state.reads = 0;
  supabase.client.from.mockImplementation(supabase.defaultFrom as never);
  for (const fn of [supabase.client.auth.setSession, supabase.client.auth.updateUser, supabase.client.auth.signOut, supabase.client.rpc, supabase.client.from]) fn.mockClear();
  // The link carries its tokens in the address fragment; leaving the page is an assignment to location.href.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { hash: "#access_token=a&refresh_token=r", pathname: "/set-password", set href(v: string) { navigatedTo = v; }, get href() { return "http://localhost/set-password"; } },
  });
  window.history.replaceState = vi.fn();
});
afterEach(() => cleanup());

async function fillAndSubmit(mode: "invite" | "reset" = "invite") {
  render(<PasswordResetForm mode={mode} />);
  const field = await screen.findByLabelText("New password");
  fireEvent.change(field, { target: { value: GOOD_PASSWORD } });
  fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: GOOD_PASSWORD } });
  fireEvent.click(screen.getByRole("button", { name: /continue/i }));
}

describe("PasswordResetForm: marking the account Active", () => {
  it("saves the password, marks the account Active, checks it took, and only then leaves the page", async () => {
    await fillAndSubmit();
    await waitFor(() => expect(navigatedTo).toBe("/"));
    expect(supabase.state.activationWrites).toEqual([{ account_status: "active" }]);
    expect(supabase.state.reads).toBe(1);
    expect(supabase.client.auth.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("treats a reset by someone who is already Active as success on the first attempt (the write matches nothing, the read-back says Active)", async () => {
    supabase.state.readStatus = "active";
    await fillAndSubmit("reset");
    await waitFor(() => expect(navigatedTo).toBe("/"));
    expect(supabase.state.activationWrites).toHaveLength(1);
  });

  it("retries a failed write and goes on once it takes", async () => {
    let calls = 0;
    supabase.client.from.mockImplementation(() => ({
      update: (values: unknown) => ({ eq: async () => { calls += 1; supabase.state.activationWrites.push(values); return { error: calls < 3 ? { message: "network" } : null }; } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_status: "active" }, error: null }) }) }),
    }) as never);
    await fillAndSubmit();
    await waitFor(() => expect(navigatedTo).toBe("/"), { timeout: 5000 });
    expect(calls).toBe(3);
  });

  it("when the write never takes, says so, stays on the page, and does not set the password a second time", async () => {
    supabase.state.updateError = { message: "network" };
    await fillAndSubmit();
    expect(await screen.findByText(/couldn.t finish activating your account/i, {}, { timeout: 8000 })).toBeTruthy();
    expect(navigatedTo).toBeNull();
    expect(supabase.client.auth.updateUser).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("New password")).toBeNull();
  }, 15000);

  it("a write that reports no error but leaves the account Invited is a failure too", async () => {
    supabase.state.readStatus = "invited";
    await fillAndSubmit();
    expect(await screen.findByText(/couldn.t finish activating your account/i, {}, { timeout: 8000 })).toBeTruthy();
    expect(navigatedTo).toBeNull();
  }, 15000);

  it("Try again activates without touching the password, then continues; Continue to the app leaves without it", async () => {
    supabase.state.readStatus = "invited";
    await fillAndSubmit();
    await screen.findByText(/couldn.t finish activating your account/i, {}, { timeout: 8000 });
    supabase.state.readStatus = "active";
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(navigatedTo).toBe("/"));
    expect(supabase.client.auth.updateUser).toHaveBeenCalledTimes(1);
  }, 20000);

  it("Continue to the app leaves even though activation failed", async () => {
    supabase.state.readStatus = "invited";
    await fillAndSubmit();
    await screen.findByText(/couldn.t finish activating your account/i, {}, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: "Continue to the app" }));
    await waitFor(() => expect(navigatedTo).toBe("/"));
  }, 20000);

  it("a refused password never reaches the activation step", async () => {
    supabase.client.auth.updateUser.mockResolvedValueOnce({ data: { user: null }, error: { message: "Password should be different" } } as never);
    await fillAndSubmit();
    expect(await screen.findByText(/Password should be different/)).toBeTruthy();
    expect(supabase.state.activationWrites).toHaveLength(0);
    expect(navigatedTo).toBeNull();
  });
});
