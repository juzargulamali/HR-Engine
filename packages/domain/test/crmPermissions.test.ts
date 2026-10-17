import { describe, expect, it } from "vitest";
import {
  canActOnFollowUp, canAssignOwner, canConfirmAvailability, canDecideApproval, canEditOpportunity, canGrantFounderRights,
  canManageApprovalRules, canManageCrmAccess, canRemoveFile, canViewCrmAudit, crmCompanyIds, hasCrmAccess, hasCrmCapability,
  isCrmFounder, isHrAdmin, type CrmGrant,
} from "../src";

const UAE = "uae";
const KSA = "ksa";
const founder: CrmGrant[] = [{ companyId: UAE, capabilities: ["founder"] }, { companyId: KSA, capabilities: ["founder"] }];
const sales: CrmGrant[] = [{ companyId: UAE, capabilities: [] }, { companyId: KSA, capabilities: [] }];
const uaeOnly: CrmGrant[] = [{ companyId: UAE, capabilities: [] }];
const delegate: CrmGrant[] = [{ companyId: UAE, capabilities: ["confirm_availability", "assign_owner"] }];

describe("CRM permissions (mirror the SQL)", () => {
  it("scopes access to the companies granted", () => {
    expect(hasCrmAccess(uaeOnly, UAE)).toBe(true);
    expect(hasCrmAccess(uaeOnly, KSA)).toBe(false);
    expect(crmCompanyIds(sales).sort()).toEqual([KSA, UAE]);
    expect(hasCrmAccess([], UAE)).toBe(false);
  });
  it("lets founder imply every capability, and delegation grant only what it names", () => {
    for (const c of ["assign_owner", "confirm_availability", "manage_settings", "manage_approval_rules", "manage_access", "view_audit"] as const) {
      expect(hasCrmCapability(founder, UAE, c)).toBe(true);
      expect(hasCrmCapability(sales, UAE, c)).toBe(false);
    }
    expect(canAssignOwner(delegate, UAE)).toBe(true);
    expect(canConfirmAvailability(delegate, UAE)).toBe(true);
    expect(canManageCrmAccess(delegate, UAE)).toBe(false);
    expect(isCrmFounder(delegate, UAE)).toBe(false);
  });
  it("keeps founder rights per company", () => {
    const uaeFounder: CrmGrant[] = [{ companyId: UAE, capabilities: ["founder"] }];
    expect(canDecideApproval(uaeFounder, UAE)).toBe(true);
    expect(canDecideApproval(uaeFounder, KSA)).toBe(false);
  });
  it("lets the owner or a founder edit; a colleague cannot", () => {
    const opp = { companyId: UAE, ownerId: "amira" };
    expect(canEditOpportunity(sales, opp, "amira")).toBe(true);
    expect(canEditOpportunity(sales, opp, "daniel")).toBe(false);
    expect(canEditOpportunity(founder, opp, "juzar")).toBe(true);
    expect(canEditOpportunity([], opp, "amira")).toBe(false); // owner who lost access
  });
  it("does not make the owner able to confirm availability or assign owners by being the owner", () => {
    expect(canConfirmAvailability(sales, UAE)).toBe(false);
    expect(canAssignOwner(sales, UAE)).toBe(false);
  });
  it("only founders may grant founder rights; a delegated manage_access cannot", () => {
    const manager: CrmGrant[] = [{ companyId: UAE, capabilities: ["manage_access"] }];
    expect(canManageCrmAccess(manager, UAE)).toBe(true);
    expect(canGrantFounderRights(manager, UAE)).toBe(false);
    expect(canGrantFounderRights(founder, UAE)).toBe(true);
  });
  it("reserves the approval policy and audit trail to the matching capability", () => {
    expect(canManageApprovalRules(sales, UAE)).toBe(false);
    expect(canViewCrmAudit(sales, UAE)).toBe(false);
    expect(canViewCrmAudit(founder, UAE)).toBe(true);
  });
  it("lets the assignee, owner or founder act on a follow-up, and others not", () => {
    const opp = { companyId: UAE, ownerId: "amira" };
    const fu = { assignedTo: "lena" };
    expect(canActOnFollowUp(uaeOnly, fu, opp, "lena")).toBe(true);
    expect(canActOnFollowUp(uaeOnly, fu, opp, "amira")).toBe(true);
    expect(canActOnFollowUp(uaeOnly, fu, opp, "daniel")).toBe(false);
    expect(canActOnFollowUp(founder, fu, opp, "juzar")).toBe(true);
  });
  it("lets the uploader, owner or founder remove a file", () => {
    const opp = { companyId: UAE, ownerId: "amira" };
    expect(canRemoveFile(uaeOnly, { uploadedBy: "daniel" }, opp, "daniel")).toBe(true);
    expect(canRemoveFile(uaeOnly, { uploadedBy: "daniel" }, opp, "lena")).toBe(false);
  });
  it("is independent of HR roles: an HR admin grant confers nothing here", () => {
    const hrGrants = [{ role: "hr_admin" as const, companyId: UAE, countryCode: null }];
    expect(isHrAdmin(hrGrants, { companyId: UAE })).toBe(true);
    expect(hasCrmAccess([], UAE)).toBe(false);
    expect(canEditOpportunity([], { companyId: UAE, ownerId: "x" }, "hr-admin-user")).toBe(false);
  });
});
