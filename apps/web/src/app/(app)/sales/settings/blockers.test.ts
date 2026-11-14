import { describe, expect, it } from "vitest";
import { SECTION, settingsBlockers } from "./blockers";

describe("what a company's missing Sales settings block", () => {
  it("no settings at all: enquiries cannot be recorded, and approval is not decided either", () => {
    const b = settingsBlockers({ settings: null, activeVatChoices: 3 });
    expect(b.map((x) => x.id)).toEqual(["no_settings", "approval_not_decided"]);
    expect(b[0]!.blocks).toContain("Enquiries cannot be recorded");
    expect(b[0]!.section).toBe(SECTION.estimates);
    expect(b[1]!.section).toBe(SECTION.approval);
  });
  it("settings saved with a policy and a VAT choice: nothing blocks", () => {
    expect(settingsBlockers({ settings: { approval_policy: "not_required" }, activeVatChoices: 1 })).toEqual([]);
    expect(settingsBlockers({ settings: { approval_policy: "required" }, activeVatChoices: 2 })).toEqual([]);
  });
  it("a policy nobody has decided blocks approvals only", () => {
    expect(settingsBlockers({ settings: { approval_policy: "not_configured" }, activeVatChoices: 1 }).map((x) => x.id)).toEqual(["approval_not_decided"]);
  });
  it("no VAT choice in use blocks issuing an estimate; a failed read of the list claims nothing", () => {
    expect(settingsBlockers({ settings: { approval_policy: "required" }, activeVatChoices: 0 }).map((x) => x.id)).toEqual(["no_vat_choice"]);
    expect(settingsBlockers({ settings: { approval_policy: "required" }, activeVatChoices: null })).toEqual([]);
  });
});
