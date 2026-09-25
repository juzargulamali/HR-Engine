import { describe, expect, it } from "vitest";
import { getPasswordIssues } from "../src/passwordPolicy";

describe("getPasswordIssues", () => {
  it("rejects short passwords", () => {
    expect(getPasswordIssues("Ab1!")).toContain("Use at least 10 characters.");
  });

  it("rejects passwords with fewer than 3 character classes", () => {
    expect(getPasswordIssues("alllowercase")).toContain(
      "Mix in at least 3 of: uppercase, lowercase, numbers, and symbols.",
    );
    expect(getPasswordIssues("alllowercase1")).toContain(
      "Mix in at least 3 of: uppercase, lowercase, numbers, and symbols.",
    );
  });

  it("accepts a password meeting length and 3 character classes", () => {
    expect(getPasswordIssues("Correct1Horse")).toEqual([]);
  });

  it("accepts a password using symbols as its third class", () => {
    expect(getPasswordIssues("lowercase!only1")).toEqual([]);
  });
});
