import { describe, expect, it } from "vitest";
import { describeHoldings, parseHoldings } from "./holdings";

const RAW = {
  blockers: [],
  pending_approvals: [{ entity_type: "leave_request", count: 2 }, { entity_type: "reimbursement_claim", count: 1 }],
  projects_managed: [{ reference: "UAE-P-0001", role: "pm" }],
  projects_acting: [{ reference: "UAE-P-0002", role: "acting_pm" }],
  teams_headed: [{ project: "UAE-P-0001", team: "Stage" }],
  roles: [{ role: "line_manager", company: "Enginious UAE" }, { role: "sys_admin", company: null }],
  module_access: [{ module: "Projects", company: "Enginious UAE" }],
  equipment_held: 3,
};

describe("account holdings", () => {
  it("parses the database's answer", () => {
    const h = parseHoldings(RAW)!;
    expect(h.pendingApprovals).toEqual([{ entityType: "leave_request", count: 2 }, { entityType: "reimbursement_claim", count: 1 }]);
    expect(h.projects).toEqual([{ reference: "UAE-P-0001", role: "pm" }, { reference: "UAE-P-0002", role: "acting_pm" }]);
    expect(h.equipmentHeld).toBe(3);
  });

  it("an answer without the blockers list is not trusted (null), so the screen cannot proceed on a half-read", () => {
    expect(parseHoldings(null)).toBeNull();
    expect(parseHoldings({})).toBeNull();
    expect(parseHoldings({ pending_approvals: [] })).toBeNull();
  });

  it("says what is held in plain English and that pending approvals are not re-routed", () => {
    const lines = describeHoldings(parseHoldings(RAW)!);
    expect(lines[0]).toContain("3 approvals waiting on this person (2 leave requests, 1 expense claim)");
    expect(lines[0]).toContain("nothing is re-routed automatically");
    expect(lines).toContain("Project Manager of 1 live project: UAE-P-0001.");
    expect(lines).toContain("Acting Project Manager of 1 live project: UAE-P-0002.");
    expect(lines).toContain("Heads 1 project team: Stage (UAE-P-0001).");
    expect(lines).toContain("HR roles: line manager (Enginious UAE), sys admin.");
    expect(lines).toContain("Module access: Projects (Enginious UAE).");
    expect(lines).toContain("3 items of equipment issued to this person.");
  });

  it("an account that holds nothing yields no warning lines", () => {
    expect(describeHoldings(parseHoldings({ blockers: [] })!)).toEqual([]);
  });
});
