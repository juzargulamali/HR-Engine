import { describe, expect, it } from "vitest";
import {
  evaluateGrant, evaluateRevoke, capabilityToggleBlockedReason, ACCESS_MODULES, ACCESS_PRESETS, applyPreset, canEditJobDetails, canManageAccountsAndRoles, canManageModuleAccess, canUsePeopleAccess, capabilitiesOf, capabilityInfo,
  describeAccess, diffCapabilities, founderOnlyCapabilities, grantableCapabilities, managedAccess, normaliseCapabilities, presetBlockedReason, presetById, targetLockedForViewer,
  type AccessModule, type RoleGrant,
} from "../src";

const role = (r: RoleGrant["role"], companyId: string | null = null): RoleGrant => ({ role: r, companyId, countryCode: null });

describe("presets are only bundles of capabilities that exist", () => {
  for (const module of ACCESS_MODULES) {
    it(`${module}: every preset capability is in the module's vocabulary and every preset id is unique`, () => {
      const vocab = new Set(capabilitiesOf(module));
      const ids = ACCESS_PRESETS[module].map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of ACCESS_PRESETS[module]) {
        for (const c of p.capabilities) expect(vocab.has(c), `${p.id}: ${c}`).toBe(true);
        expect(p.label.length).toBeGreaterThan(0);
        expect(p.summary.length).toBeGreaterThan(0);
      }
    });
    it(`${module}: every capability has a label and a description, and some preset (or Custom) can grant it`, () => {
      for (const c of capabilitiesOf(module)) {
        const info = capabilityInfo(module, c);
        expect(info.label).not.toBe(c);
        expect(info.description.length).toBeGreaterThan(0);
      }
      const covered = new Set(ACCESS_PRESETS[module].flatMap((p) => p.capabilities));
      // every capability except those deliberately left to Custom is reachable from a preset
      const custom: Record<AccessModule, string[]> = { sales: [], projects: [], inventory: [], budget: [] };
      for (const c of capabilitiesOf(module)) expect(covered.has(c) || custom[module].includes(c), `${module}.${c}`).toBe(true);
    });
  }

  it("the budget vocabulary is the one the database function uses", () => {
    expect([...capabilitiesOf("budget")].sort()).toEqual(["executive_approver", "finance", "manage_access", "view"]);
  });
});

describe("who may give what is exactly today's rule", () => {
  it("Sales, Projects: founder and access management are founder-only; Inventory also cost visibility; Budget has no founder tier", () => {
    expect(founderOnlyCapabilities("sales")).toEqual(["founder", "manage_access"]);
    expect(founderOnlyCapabilities("projects")).toEqual(["founder", "manage_access"]);
    expect(founderOnlyCapabilities("inventory")).toEqual(["founder", "manage_access", "view_costs"]);
    expect(founderOnlyCapabilities("budget")).toEqual([]);
  });

  it("a founder holds access management implicitly (Sales, Projects, Inventory); Budget needs the explicit capability", () => {
    expect(canManageModuleAccess("sales", ["founder"])).toBe(true);
    expect(canManageModuleAccess("projects", ["founder"])).toBe(true);
    expect(canManageModuleAccess("inventory", ["founder"])).toBe(true);
    expect(canManageModuleAccess("budget", ["founder"])).toBe(false);
    expect(canManageModuleAccess("budget", ["finance"])).toBe(false);
    expect(canManageModuleAccess("budget", ["manage_access"])).toBe(true);
  });

  it("an access manager (not a founder) cannot give founder, access or (Inventory) cost rights; a founder can give everything", () => {
    expect(grantableCapabilities("sales", ["manage_access"])).not.toContain("founder");
    expect(grantableCapabilities("sales", ["manage_access"])).not.toContain("manage_access");
    expect(grantableCapabilities("sales", ["manage_access"])).toContain("assign_owner");
    expect(grantableCapabilities("inventory", ["manage_access"])).not.toContain("view_costs");
    expect(grantableCapabilities("inventory", ["manage_access"])).toContain("view_stock");
    expect(grantableCapabilities("inventory", ["founder"])).toEqual([...capabilitiesOf("inventory")]);
    expect(grantableCapabilities("budget", ["manage_access"])).toEqual([...capabilitiesOf("budget")]);
  });

  it("someone with no access-management right can grant nothing", () => {
    for (const m of ACCESS_MODULES) expect(grantableCapabilities(m, [])).toEqual([]);
    expect(grantableCapabilities("budget", ["finance", "executive_approver"])).toEqual([]);
  });

  it("a non-founder cannot change a person who holds a founder-only right", () => {
    expect(targetLockedForViewer("projects", ["manage_access"], ["manage_access"])).toBe(true);
    expect(targetLockedForViewer("projects", ["manage_access"], ["assign_pm"])).toBe(false);
    expect(targetLockedForViewer("projects", ["founder"], ["founder", "manage_access"])).toBe(false);
    expect(targetLockedForViewer("inventory", ["manage_access"], ["view_costs"])).toBe(true);
    expect(targetLockedForViewer("budget", ["manage_access"], ["finance", "executive_approver", "manage_access"])).toBe(false);
  });

  it("explains why a preset is not available, and never blocks one the viewer may give", () => {
    expect(presetBlockedReason("inventory", ["manage_access"], presetById("inventory", "inventory-costs")!)).toMatch(/Inventory founder/);
    expect(presetBlockedReason("inventory", ["manage_access"], presetById("inventory", "inventory-storekeeper")!)).toBeNull();
    expect(presetBlockedReason("inventory", ["founder"], presetById("inventory", "inventory-costs")!)).toBeNull();
    expect(presetBlockedReason("sales", ["manage_access"], presetById("sales", "sales-founder")!)).toMatch(/Sales founder/);
    // rule R1: only a CEO / CTO approver gives the approver right
    expect(presetBlockedReason("budget", ["manage_access"], presetById("budget", "budget-approver")!)).toMatch(/CEO \/ CTO approver of this company/);
    expect(presetBlockedReason("budget", ["manage_access", "executive_approver"], presetById("budget", "budget-approver")!)).toBeNull();
    expect(presetBlockedReason("budget", ["manage_access"], presetById("budget", "budget-finance")!)).toBeNull();
  });
});

describe("presets preserve existing access", () => {
  it("applying a preset adds to what the person already has", () => {
    const storekeeper = presetById("inventory", "inventory-storekeeper")!;
    expect(applyPreset("inventory", ["view_audit"], storekeeper)).toEqual(["warehouse", "view_audit"]);
    expect(applyPreset("inventory", ["warehouse"], storekeeper)).toEqual(["warehouse"]);
  });

  it("keeps the module's own order and ignores anything that is not a capability of the module", () => {
    expect(normaliseCapabilities("projects", ["view_commercial", "nonsense", "assign_pm", "assign_pm"])).toEqual(["assign_pm", "view_commercial"]);
  });

  it("shows exactly what a change adds and removes", () => {
    const d = diffCapabilities("sales", ["assign_owner", "view_audit"], ["assign_owner", "reopen_closed"]);
    expect(d).toEqual({ added: ["reopen_closed"], removed: ["view_audit"], unchanged: ["assign_owner"] });
    const same = diffCapabilities("sales", ["assign_owner"], ["assign_owner"]);
    expect(same.added).toEqual([]);
    expect(same.removed).toEqual([]);
  });

  it("names what a person holds by the presets it covers, plus anything left over", () => {
    const d = describeAccess("inventory", ["warehouse", "cross_location", "view_audit", "view_stock"]);
    expect(d.presets.map((p) => p.id)).toEqual(expect.arrayContaining(["inventory-storekeeper", "inventory-stock-lead", "inventory-audit", "inventory-viewer"]));
    expect(d.extra).toEqual([]);
    expect(describeAccess("inventory", []).basic).toBe(true);
    expect(describeAccess("sales", ["assign_owner"]).presets.map((p) => p.id)).toEqual([]);
    expect(describeAccess("sales", ["assign_owner"]).extra).toEqual(["assign_owner"]);
  });
});

describe("who sees what", () => {
  it("accounts and HR roles stay with the System Administrator only", () => {
    expect(canManageAccountsAndRoles([role("sys_admin")])).toBe(true);
    for (const r of ["hr_admin", "finance", "ceo", "cto", "line_manager", "employee"] as const) expect(canManageAccountsAndRoles([role(r)])).toBe(false);
  });

  it("job details are editable by the HR Admin of that employee's company only, not by the System Administrator", () => {
    expect(canEditJobDetails([role("hr_admin", "co-a")], "co-a")).toBe(true);
    expect(canEditJobDetails([role("hr_admin", "co-a")], "co-b")).toBe(false);
    expect(canEditJobDetails([role("hr_admin")], "co-b")).toBe(true);
    expect(canEditJobDetails([role("sys_admin")], "co-a")).toBe(false);
    expect(canEditJobDetails([role("finance", "co-a")], "co-a")).toBe(false);
  });

  it("module access is managed only where the person holds the right, per company", () => {
    const grants = [
      { module: "sales" as const, companyId: "a", capabilities: ["founder"] },
      { module: "projects" as const, companyId: "a", capabilities: ["assign_pm"] },
      { module: "inventory" as const, companyId: "b", capabilities: ["manage_access"] },
      { module: "budget" as const, companyId: "b", capabilities: ["finance"] },
    ];
    expect(managedAccess(grants)).toEqual([
      { module: "sales", companyId: "a", isFounder: true },
      { module: "inventory", companyId: "b", isFounder: false },
    ]);
  });

  it("the screen is offered to a System Administrator, an HR Admin, or anyone who manages some module access, and to nobody else", () => {
    expect(canUsePeopleAccess([role("sys_admin")], [])).toBe(true);
    expect(canUsePeopleAccess([role("hr_admin", "a")], [])).toBe(true);
    expect(canUsePeopleAccess([role("employee")], [{ module: "budget", companyId: "a", capabilities: ["manage_access"] }])).toBe(true);
    expect(canUsePeopleAccess([role("ceo"), role("finance")], [{ module: "budget", companyId: "a", capabilities: ["finance", "executive_approver"] }])).toBe(false);
    expect(canUsePeopleAccess([role("employee")], [])).toBe(false);
  });
});

describe("access grant rules R1 to R3 (mirrors of the database functions)", () => {
  const other = { capabilities: [] as string[], self: false };

  it("R1: only a CEO / CTO approver of the company adds or removes the approver right", () => {
    const manager = ["finance", "manage_access"];
    expect(evaluateGrant("budget", manager, other, ["executive_approver"]).allowed).toBe(false);
    expect(evaluateGrant("budget", manager, { capabilities: ["executive_approver"], self: false }, []).allowed).toBe(false);
    expect(evaluateRevoke("budget", manager, { capabilities: ["executive_approver"], self: false }).allowed).toBe(false);
    const approver = ["manage_access", "executive_approver"];
    expect(evaluateGrant("budget", approver, other, ["executive_approver"]).allowed).toBe(true);
    expect(evaluateGrant("budget", approver, { capabilities: ["executive_approver"], self: false }, []).allowed).toBe(true);
    expect(evaluateRevoke("budget", approver, { capabilities: ["executive_approver"], self: false }).allowed).toBe(true);
  });

  it("R1 leaves everything else about an approver alone: another right can still be added or removed without touching the approver right", () => {
    const manager = ["manage_access"];
    expect(evaluateGrant("budget", manager, { capabilities: ["executive_approver"], self: false }, ["executive_approver", "view"]).allowed).toBe(true);
    expect(evaluateGrant("budget", manager, { capabilities: ["executive_approver", "view"], self: false }, ["executive_approver"]).allowed).toBe(true);
  });

  it("R2: nobody adds a right to their own grant (Budget and Sales); removing one's own right stays allowed", () => {
    expect(evaluateGrant("budget", ["manage_access"], { capabilities: ["manage_access"], self: true }, ["manage_access", "finance"]).allowed).toBe(false);
    expect(evaluateGrant("budget", ["manage_access", "finance"], { capabilities: ["manage_access", "finance"], self: true }, ["manage_access"]).allowed).toBe(true);
    expect(evaluateGrant("budget", ["manage_access", "executive_approver"], { capabilities: ["manage_access", "executive_approver"], self: true }, ["manage_access", "executive_approver", "finance"]).reason).toMatch(/own access/);
    expect(evaluateGrant("sales", ["manage_access"], { capabilities: ["manage_access"], self: true }, ["manage_settings"]).allowed).toBe(false);
    expect(evaluateGrant("sales", ["manage_access"], { capabilities: ["manage_access", "assign_owner"], self: true }, ["manage_access", "assign_owner"]).allowed).toBe(false); // a non-founder cannot send access management at all
    expect(evaluateGrant("sales", ["manage_access", "assign_owner"], { capabilities: ["manage_access", "assign_owner"], self: true }, ["assign_owner"]).allowed).toBe(true);
    // a Sales founder already holds every right: nothing they could type is an addition in effect
    expect(evaluateGrant("sales", ["founder"], { capabilities: ["founder"], self: true }, ["founder", "view_audit"]).allowed).toBe(true);
  });

  it("R3: a non-founder cannot withdraw another access manager (Sales, Projects, Inventory) or cost reader (Inventory); stepping down oneself stays allowed", () => {
    for (const module of ["sales", "projects", "inventory"] as const) {
      expect(evaluateRevoke(module, ["manage_access"], { capabilities: ["manage_access"], self: false }).allowed, module).toBe(false);
      expect(evaluateRevoke(module, ["manage_access"], { capabilities: ["manage_access"], self: true }).allowed, `${module} self`).toBe(true);
      expect(evaluateRevoke(module, ["founder"], { capabilities: ["manage_access"], self: false }).allowed, `${module} founder`).toBe(true);
      expect(evaluateRevoke(module, ["manage_access"], { capabilities: ["founder"], self: false }).allowed, `${module} founder target`).toBe(false);
      expect(evaluateRevoke(module, ["manage_access"], { capabilities: ["assign_owner"], self: false }).allowed || module !== "sales", module).toBe(true);
    }
    expect(evaluateRevoke("inventory", ["manage_access"], { capabilities: ["view_costs"], self: false }).allowed).toBe(false);
    expect(evaluateRevoke("inventory", ["manage_access"], { capabilities: ["warehouse"], self: false }).allowed).toBe(true);
  });

  it("R3 in Sales also covers replacing another access manager's rights through the grant function", () => {
    expect(evaluateGrant("sales", ["manage_access"], { capabilities: ["manage_access", "assign_owner"], self: false }, ["assign_owner"]).allowed).toBe(false);
    expect(evaluateGrant("sales", ["founder"], { capabilities: ["manage_access", "assign_owner"], self: false }, ["assign_owner"]).allowed).toBe(true);
  });

  it("unchanged rules still hold: only a founder hands out founder-only rights; Projects and Inventory protect their access managers entirely", () => {
    expect(evaluateGrant("projects", ["manage_access"], other, ["manage_access"]).reason).toMatch(/Projects founder/);
    expect(evaluateGrant("inventory", ["manage_access"], other, ["view_costs"]).reason).toMatch(/Inventory founder/);
    expect(evaluateGrant("projects", ["manage_access"], { capabilities: ["manage_access"], self: true }, []).allowed).toBe(false);
    expect(evaluateGrant("inventory", ["founder"], { capabilities: ["view_costs"], self: false }, ["view_stock"]).allowed).toBe(true);
    expect(evaluateGrant("sales", [], other, ["assign_owner"]).allowed).toBe(false);
  });

  it("a toggle is blocked exactly when the resulting set would be refused, with the reason", () => {
    const self = { capabilities: ["manage_access"], self: true };
    expect(capabilityToggleBlockedReason("budget", ["manage_access"], self, ["manage_access"], "finance")).toMatch(/own access/);
    expect(capabilityToggleBlockedReason("budget", ["manage_access"], self, ["manage_access", "finance"], "finance")).toBeNull();
    expect(capabilityToggleBlockedReason("budget", ["manage_access"], other, [], "executive_approver")).toMatch(/CEO \/ CTO approver/);
    expect(capabilityToggleBlockedReason("budget", ["manage_access"], other, [], "view")).toBeNull();
  });

  it("budget has no person that is locked as a whole; Sales access managers can step down but not be changed by a non-founder", () => {
    expect(targetLockedForViewer("budget", ["manage_access"], ["executive_approver", "manage_access"])).toBe(false);
    expect(targetLockedForViewer("sales", ["manage_access"], ["manage_access"], false)).toBe(true);
    expect(targetLockedForViewer("sales", ["manage_access"], ["manage_access"], true)).toBe(false);
    expect(targetLockedForViewer("projects", ["manage_access"], ["manage_access"], true)).toBe(true);
  });
});
