import { describe, expect, it } from "vitest";
import {
  ACCESS_MODULES, ACCESS_PROFILES, ADVANCED_GROUPS, capabilitiesOf, capabilityInfo, chooseProfile, chooseScope, draftCapabilities, evaluateGrant, initialDraft, profileById,
  recogniseAccess, reviewDraft, summariseAccess, toggleExtra, PROJECTS_PM_NOTE,
} from "../src";

describe("one source of truth for working profiles", () => {
  for (const module of ACCESS_MODULES) {
    it(`${module}: profiles use real capabilities, unique ids, and every capability sits in exactly one advanced group`, () => {
      const vocab = new Set(capabilitiesOf(module));
      const ids = ACCESS_PROFILES[module].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of ACCESS_PROFILES[module]) {
        expect(p.module).toBe(module);
        for (const c of p.capabilities) expect(vocab.has(c), `${p.id}: ${c}`).toBe(true);
        expect(p.description.length).toBeGreaterThan(10);
        expect(p.exclusions.length).toBeGreaterThan(10);
      }
      const grouped = ADVANCED_GROUPS[module].flatMap((g) => g.capabilities);
      expect([...grouped].sort()).toEqual([...capabilitiesOf(module)].sort());
    });
  }

  it("maps each working profile to the verified capabilities, and Projects has no PM or founder profile", () => {
    const m = (module: "inventory" | "sales" | "budget" | "projects") => Object.fromEntries(ACCESS_PROFILES[module].map((p) => [p.label, [...p.capabilities]]));
    expect(m("inventory")).toEqual({ "Warehouse operator": ["warehouse"], "Warehouse lead": ["warehouse", "cross_location"], "Stock viewer": ["view_stock"], "Employee equipment viewer": ["view_employee_custody"] });
    expect(m("sales")).toEqual({ "Sales colleague": [], "Sales lead": ["assign_owner", "reopen_closed"] });
    expect(m("budget")).toEqual({ "Read-only": ["view"], Finance: ["finance"], "Executive approver": ["executive_approver"] });
    expect(m("projects")).toEqual({ "Project directory viewer": [] });
    expect(PROJECTS_PM_NOTE).toBe("PM assignment and project team membership are managed on the project or handover.");
  });

  it("cards, editor review and saved capabilities all derive from the same definitions", () => {
    for (const module of ACCESS_MODULES) for (const p of ACCESS_PROFILES[module]) {
      const d = chooseProfile(module, initialDraft(module, null, []), p.id, null);
      const saved = draftCapabilities(module, d);
      expect(saved).toEqual([...p.capabilities]);
      const review = reviewDraft(module, d, null, []);
      expect(review.caps).toEqual(saved);
      expect(review.summary[0]).toBe(`${p.label}: ${p.description}`);
      expect(review.summary).toContain(`Not included: ${p.exclusions}`);
      expect(recogniseAccess(module, saved).profile?.id).toBe(p.id);
    }
    expect(summariseAccess("sales", ["assign_owner", "reopen_closed", "manage_settings"])).toContain(`${capabilityInfo("sales", "manage_settings").label}: ${capabilityInfo("sales", "manage_settings").description}`);
  });
});

describe("recognising access from capabilities", () => {
  it("exact, profile plus extras, and custom", () => {
    expect(recogniseAccess("sales", [])).toMatchObject({ profile: { id: "sales-colleague" }, extras: [], custom: false });
    expect(recogniseAccess("inventory", ["warehouse", "view_audit"])).toMatchObject({ profile: { id: "warehouse-operator" }, extras: ["view_audit"] });
    expect(recogniseAccess("inventory", ["warehouse", "cross_location", "view_stock"])).toMatchObject({ profile: { id: "warehouse-lead" }, extras: ["view_stock"] });
    expect(recogniseAccess("sales", ["manage_settings"])).toMatchObject({ profile: null, extras: ["manage_settings"], custom: true });
    expect(recogniseAccess("inventory", ["founder"]).custom).toBe(true);
  });
});

describe("draft editing", () => {
  it("opening the editor changes nothing", () => {
    const orig = ["assign_owner", "reopen_closed", "view_audit"];
    const d = initialDraft("sales", orig, []);
    const r = reviewDraft("sales", d, orig, []);
    expect(r.changed).toBe(false);
    expect(r.retained).toEqual(["view_audit"]);
  });

  it("switching profile replaces only the previous profile bundle and keeps custom rights listed (no accumulation)", () => {
    const orig = ["finance", "manage_access"];
    let d = initialDraft("budget", orig, []);
    expect(d.profileId).toBe("budget-finance");
    d = chooseProfile("budget", d, "budget-read-only", orig);
    expect(draftCapabilities("budget", d)).toEqual(["view", "manage_access"]);
    let r = reviewDraft("budget", d, orig, []);
    expect(r.added).toEqual(["view"]);
    expect(r.removed).toEqual(["finance"]);
    expect(r.retained).toEqual(["manage_access"]);
    expect(r.needsRemovalConfirm).toBe(true);
    d = chooseProfile("budget", d, "budget-finance", orig);
    r = reviewDraft("budget", d, orig, []);
    expect(r.changed).toBe(false);
  });

  it("custom rights are removed only by an explicit untick", () => {
    const orig = ["assign_owner", "reopen_closed", "view_audit"];
    let d = initialDraft("sales", orig, []);
    d = chooseProfile("sales", d, "sales-colleague", orig);
    expect(reviewDraft("sales", d, orig, []).removed).toEqual(["assign_owner", "reopen_closed"]);
    expect(draftCapabilities("sales", d)).toContain("view_audit");
    d = toggleExtra("sales", d, "view_audit", false);
    expect(reviewDraft("sales", d, orig, []).removed).toContain("view_audit");
    // a right that belongs to the chosen profile cannot be toggled off separately
    const lead = chooseProfile("sales", d, "sales-lead", orig);
    expect(toggleExtra("sales", lead, "assign_owner", false)).toEqual(lead);
  });

  it("warehouse scope is a separate explicit choice; Warehouse lead never grants all locations silently", () => {
    let d = chooseProfile("inventory", initialDraft("inventory", null, []), "warehouse-lead", null);
    let r = reviewDraft("inventory", d, null, []);
    expect(r.scopeMissing).toBe(true);
    d = chooseScope("inventory", d, "all");
    r = reviewDraft("inventory", d, null, []);
    expect(r.scopeMissing).toBe(false);
    expect(r.caps).toEqual(["warehouse", "cross_location"]);
    // choosing chosen warehouses drops all-location authority
    d = chooseScope("inventory", d, "chosen");
    expect(draftCapabilities("inventory", d)).toEqual(["warehouse"]);
    expect(reviewDraft("inventory", d, null, []).locationsMissing).toBe(true);
    d = { ...d, locationIds: ["l1"] };
    expect(reviewDraft("inventory", d, null, ["l1"]).locationsMissing).toBe(false);
    // an existing lead keeps its scope when reopened, a viewer moved to operator must choose
    expect(initialDraft("inventory", ["warehouse", "cross_location"], []).scope).toBe("all");
    const v = chooseProfile("inventory", initialDraft("inventory", ["view_stock"], []), "warehouse-operator", ["view_stock"]);
    expect(reviewDraft("inventory", v, ["view_stock"], []).scopeMissing).toBe(true);
  });

  it("a viewer who may not grant a right is refused by the rule the database applies, for a profile bundle and for a custom right", () => {
    const mgr = ["manage_access"];
    const founderOnly = initialDraft("inventory", null, []);
    const withCosts = toggleExtra("inventory", founderOnly, "view_costs", true);
    expect(evaluateGrant("inventory", mgr, { capabilities: [], self: false }, draftCapabilities("inventory", withCosts)).allowed).toBe(false);
    const lead = chooseProfile("inventory", founderOnly, "warehouse-operator", null);
    expect(evaluateGrant("inventory", mgr, { capabilities: [], self: false }, draftCapabilities("inventory", lead)).allowed).toBe(true);
    expect(profileById("budget", "budget-executive")?.capabilities).toEqual(["executive_approver"]);
    expect(evaluateGrant("budget", ["manage_access"], { capabilities: [], self: false }, ["executive_approver"]).allowed).toBe(false);
  });
});
