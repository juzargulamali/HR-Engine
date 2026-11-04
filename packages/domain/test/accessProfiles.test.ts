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
    expect(m("inventory")).toEqual({ "Warehouse operator": ["warehouse"], "Warehouse operator — all locations": ["warehouse", "cross_location"], "Stock viewer": ["view_stock"], "Employee equipment viewer": ["view_employee_custody"] });
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
    // unticking a right of the chosen profile leaves the profile; the rest of its bundle stays as custom rights
    const lead = chooseProfile("sales", d, "sales-lead", orig);
    const custom = toggleExtra("sales", lead, "assign_owner", false);
    expect(custom.profileId).toBeNull();
    expect(draftCapabilities("sales", custom)).toEqual(["reopen_closed"]);
  });

  it("warehouse scope is a separate explicit choice; the all-locations profile never grants all locations silently", () => {
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

describe("final access summary never contradicts the final rights", () => {
  const text = (module: "inventory" | "sales", caps: string[]) => summariseAccess(module, caps).join("\n");
  const COSTS = capabilityInfo("inventory", "view_costs");

  it("the two warehouse profiles have distinct names, and the profile is shown as before when the set equals the bundle", () => {
    const labels = ACCESS_PROFILES.inventory.map((p) => p.label);
    expect(labels).toContain("Warehouse operator");
    expect(labels).toContain("Warehouse operator — all locations");
    expect(new Set(labels).size).toBe(labels.length);
    expect(summariseAccess("inventory", ["view_stock"])[0]).toBe("Stock viewer: Reads every unit, quantity and movement, including who holds what. Read only.");
  });

  it("retained custom right: a Stock viewer who already holds the cost right is described as able to see costs and not told otherwise", () => {
    const t = text("inventory", ["view_stock", "view_costs"]);
    expect(t).toContain(`${COSTS.label}: ${COSTS.description}`);
    expect(t).not.toMatch(/cannot see purchase costs/i);
    expect(t).not.toMatch(/Not included:/);
    expect(t).not.toMatch(/Does not include:[^\n]*purchase costs/);
    expect(t).toMatch(/Does not include:[^\n]*receive, issue, return, transfer or count stock/);
  });

  it("newly ticked advanced right: the review of a draft says the person can see costs", () => {
    const orig = ["view_stock"];
    const d = toggleExtra("inventory", initialDraft("inventory", orig, []), "view_costs", true);
    const r = reviewDraft("inventory", d, orig, []);
    expect(r.added).toEqual(["view_costs"]);
    const t = r.summary.join("\n");
    expect(t).toContain(COSTS.description);
    expect(t).not.toMatch(/cannot see purchase costs|Not included:/i);
    expect(t).not.toMatch(/Does not include:[^\n]*purchase costs/);
  });

  it("removed right: untick a profile right and the summary no longer claims it, and lists it as not included", () => {
    const d = toggleExtra("sales", chooseProfile("sales", initialDraft("sales", null, []), "sales-lead", null), "reopen_closed", false);
    const t = summariseAccess("sales", draftCapabilities("sales", d)).join("\n");
    expect(t).not.toMatch(/Sales lead:/);
    expect(t).toMatch(/Does not include:[^\n]*reopen closed opportunities/);
    expect(t).not.toMatch(/Does not include:[^\n]*assign owners/);
  });

  it("a founder is told no exclusions", () => {
    expect(text("inventory", ["founder"])).not.toMatch(/Does not include|Not included/);
  });
});

describe("warehouse assignments in the review", () => {
  const op = ["warehouse"];
  it("lists added and removed warehouses and requires confirmation only for removal", () => {
    let d = initialDraft("inventory", op, ["l1", "l2"]);
    d = { ...d, locationIds: ["l2", "l3"] };
    const r = reviewDraft("inventory", d, op, ["l1", "l2"]);
    expect(r.locationsAdded).toEqual(["l3"]);
    expect(r.locationsRemoved).toEqual(["l1"]);
    expect(r.changed).toBe(true);
    expect(r.needsRemovalConfirm).toBe(true);
    const add = reviewDraft("inventory", { ...initialDraft("inventory", op, ["l1"]), locationIds: ["l1", "l2"] }, op, ["l1"]);
    expect(add.locationsAdded).toEqual(["l2"]);
    expect(add.locationsRemoved).toEqual([]);
    expect(add.needsRemovalConfirm).toBe(false);
  });

  it("moving an operator with assigned warehouses to all locations drops them: removal, confirmation, and the list saved is empty", () => {
    const d = chooseScope("inventory", initialDraft("inventory", op, ["l1", "l2"]), "all");
    const r = reviewDraft("inventory", d, op, ["l1", "l2"]);
    expect(r.caps).toEqual(["warehouse", "cross_location"]);
    expect(r.locationsRemoved).toEqual(["l1", "l2"]);
    expect(r.locationIdsToSave).toEqual([]);
    expect(r.needsRemovalConfirm).toBe(true);
  });

  it("an all-locations person is unchanged when reopened, even if old assignments exist; all to chosen needs no confirmation", () => {
    const all = ["warehouse", "cross_location"];
    const same = reviewDraft("inventory", initialDraft("inventory", all, ["l1"]), all, ["l1"]);
    expect(same.changed).toBe(false);
    expect(same.locationIdsToSave).toBeNull();
    expect(same.needsRemovalConfirm).toBe(false);
  });
});
