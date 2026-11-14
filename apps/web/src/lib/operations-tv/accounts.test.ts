import { describe, expect, it } from "vitest";
import { displayFullName, displayState, friendlyDisplayError, generateDisplayPassword, isValidEmail, isValidTimeZone, normaliseEmail, parseDisplayRows } from "./accounts";

describe("display account helpers", () => {
  it("makes a long random password with every character class, from a fresh random source each time", () => {
    const a = generateDisplayPassword(); const b = generateDisplayPassword();
    expect(a.length).toBeGreaterThanOrEqual(24); expect(a).not.toBe(b);
    for (const p of [a, b]) expect(p).toMatch(/[a-z]/), expect(p).toMatch(/[A-Z]/), expect(p).toMatch(/[0-9]/), expect(p).toMatch(/[^A-Za-z0-9]/);
  });
  it("adds the missing classes when the random bytes happen to lack them", () => {
    const zeros = (n: number) => new Uint8Array(n);                            // base64url of 24 zero bytes is all "A": upper case only
    const p = generateDisplayPassword(zeros);
    expect(p).toMatch(/[a-z]/); expect(p).toMatch(/[0-9]/); expect(p).toMatch(/[^A-Za-z0-9]/); expect(p.length).toBeGreaterThanOrEqual(24);
  });
  it("validates and normalises the sign-in e-mail and the zone", () => {
    expect(normaliseEmail("  Office.TV@Example.AE ")).toBe("office.tv@example.ae");
    expect(isValidEmail("office.tv@example.ae")).toBe(true);
    for (const bad of ["", "no-at", "a@b", "a b@c.de", "@x.de", "a@.de"]) expect(isValidEmail(bad), bad).toBe(false);
    expect(isValidTimeZone("Asia/Dubai")).toBe(true); expect(isValidTimeZone("Mars/Base")).toBe(false); expect(isValidTimeZone("")).toBe(false);
  });
  it("reads the display list defensively, active first then newest, dropping rows it cannot identify", () => {
    const rows = parseDisplayRows([
      { id: "r1", user_id: "u1", label: "Old TV", created_at: "2026-11-01T00:00:00Z", revoked_at: "2026-11-05T00:00:00Z" },
      { id: "a1", user_id: "u2", label: "Office TV", office_tz: "Asia/Dubai", created_at: "2026-11-02T00:00:00Z", last_seen_at: "2026-11-14T09:00:00Z", email: "tv@example.ae" },
      { id: "a2", user_id: "u3", created_at: "2026-11-03T00:00:00Z" },
      { user_id: "u4" }, null, "x",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a2", "a1", "r1"]);
    expect(rows[0]).toMatchObject({ label: "Display", officeTz: "Asia/Dubai", email: null });
    expect(displayState(rows[2]!)).toBe("revoked"); expect(displayState(rows[1]!)).toBe("active");
    expect(parseDisplayRows(undefined)).toEqual([]);
  });
  it("names the account for what it is, and turns errors into plain words without echoing internals", () => {
    expect(displayFullName("Office TV")).toBe("Office board: Office TV");
    expect(friendlyDisplayError({ code: "42501", message: "permission denied for table secret_table" }, "x")).toMatch(/Operations Manager/);
    expect(friendlyDisplayError({ code: "42883", message: "function ops_tv_register_display does not exist" }, "x")).toMatch(/not installed/);
    expect(friendlyDisplayError({ message: "User already registered" }, "x")).toMatch(/already has an account/);
    expect(friendlyDisplayError({ message: "JWT secret xyz leaked" }, "Try again.")).toBe("Try again.");
  });
});
