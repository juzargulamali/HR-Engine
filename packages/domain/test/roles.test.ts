import { describe, expect, it } from "vitest";
import { ROLES, ROLE_LABELS, isAppRole } from "../src/roles";

describe("roles", () => {
  it("has a label for every role", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it("recognizes valid role strings and rejects unknown ones", () => {
    expect(isAppRole("hr_admin")).toBe(true);
    expect(isAppRole("superuser")).toBe(false);
  });
});
