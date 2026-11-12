// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EmailLinkForwarder } from "./email-link-forwarder";

// Made-up placeholders, not real tokens.
const SESSION = "#access_token=AAA&refresh_token=RRR&type=invite";
const replace = vi.fn();
const real = window.location;
const at = (hash: string, search = "") => {
  Object.defineProperty(window, "location", { configurable: true, value: { hash, search, pathname: "/login", replace } });
};
beforeEach(() => { replace.mockClear(); });
afterEach(() => { cleanup(); Object.defineProperty(window, "location", { configurable: true, value: real }); });

describe("an emailed link that arrives on the sign-in page", () => {
  it("an invite is passed on to /set-password with its session still in the address", () => {
    at(SESSION);
    render(<EmailLinkForwarder />);
    expect(replace).toHaveBeenCalledWith(`/set-password${SESSION}`);
    expect(screen.queryByTestId("email-link-used")).toBeNull();
  });
  it("a password reset is passed on to /reset-password", () => {
    at("#access_token=AAA&refresh_token=RRR&type=recovery");
    render(<EmailLinkForwarder />);
    expect(replace).toHaveBeenCalledWith("/reset-password#access_token=AAA&refresh_token=RRR&type=recovery");
  });
  it("a used or expired link is said to be so, with what to do, and its error is taken out of the address", () => {
    const replaceState = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
    at("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
    render(<EmailLinkForwarder />);
    expect(screen.getByTestId("email-link-used").textContent).toMatch(/already been used or has expired.*Forgot password/);
    expect(replace).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/login");
    replaceState.mockRestore();
  });
  it("an ordinary visit to the sign-in page shows nothing and goes nowhere", () => {
    at("", "?next=%2Fprojects");
    const { container } = render(<EmailLinkForwarder />);
    expect(container.innerHTML).toBe("");
    expect(replace).not.toHaveBeenCalled();
  });
});
