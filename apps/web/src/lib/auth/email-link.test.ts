import { describe, expect, it } from "vitest";
import { emailLinkDestination, isUsedOrExpired, readEmailLink } from "./email-link";

// The values below are made-up placeholders, not real tokens.
const session = (type: string) => `#access_token=AAA&refresh_token=RRR&expires_in=3600&token_type=bearer&type=${type}`;
const EXPIRED = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

describe("readEmailLink", () => {
  it("reads the session a working invite or reset link leaves after #", () => {
    expect(readEmailLink(session("invite"))).toEqual({ kind: "tokens", accessToken: "AAA", refreshToken: "RRR", type: "invite" });
    expect(readEmailLink(session("recovery").slice(1))).toMatchObject({ kind: "tokens", type: "recovery" });
  });
  it("needs both halves of the session", () => {
    expect(readEmailLink("#access_token=AAA&type=invite")).toEqual({ kind: "none" });
    expect(readEmailLink("#refresh_token=RRR")).toEqual({ kind: "none" });
  });
  it("tells a used or expired link apart, whether the error is after # or after ?", () => {
    expect(readEmailLink(EXPIRED)).toEqual({ kind: "error", code: "otp_expired", description: "Email link is invalid or has expired" });
    expect(isUsedOrExpired(readEmailLink(EXPIRED))).toBe(true);
    expect(isUsedOrExpired(readEmailLink("", "?error=access_denied&error_code=otp_expired"))).toBe(true);
    expect(isUsedOrExpired(readEmailLink("#error=server_error&error_description=Something+else"))).toBe(false);
  });
  it("recognises a link made the older way (?code=) and an address with nothing in it", () => {
    expect(readEmailLink("", "?code=CCC")).toEqual({ kind: "code" });
    expect(readEmailLink("", "")).toEqual({ kind: "none" });
    expect(isUsedOrExpired(readEmailLink("", "?code=CCC"))).toBe(false);
  });
});

describe("emailLinkDestination: a link that landed on the sign-in page", () => {
  it("sends an invite to /set-password and a password reset to /reset-password", () => {
    expect(emailLinkDestination(session("invite"))).toBe("/set-password");
    expect(emailLinkDestination(session("signup"))).toBe("/set-password");
    expect(emailLinkDestination(session("recovery"))).toBe("/reset-password");
  });
  it("forwards nothing without a session, for an error, or for another kind of link", () => {
    expect(emailLinkDestination("")).toBeNull();
    expect(emailLinkDestination(EXPIRED)).toBeNull();
    expect(emailLinkDestination(session("magiclink"))).toBeNull();
    expect(emailLinkDestination("#access_token=AAA&refresh_token=RRR")).toBeNull();
  });
});
