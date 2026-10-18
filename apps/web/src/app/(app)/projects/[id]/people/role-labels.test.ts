import { describe, expect, it } from "vitest";
import { isActingCurrent, roleLabels, teamNameOf, type PersonLike, type TeamLike } from "./role-labels";

const teams: TeamLike[] = [{ id: "t1", name: "Programming", head_user_id: "u-head" }, { id: "t2", name: "Content", head_user_id: "u-pm" }];
const p = (over: Partial<PersonLike>): PersonLike => ({ user_id: "u", role: "member", team_id: null, is_team_head: false, acting_until: null, ...over });

describe("roleLabels", () => {
  it("names the PM, a plain member and a department head", () => {
    expect(roleLabels(p({ role: "pm", user_id: "u-x" }), teams, "2099-01-01")).toEqual(["Project Manager"]);
    expect(roleLabels(p({}), teams, "2099-01-01")).toEqual(["Member"]);
    expect(roleLabels(p({ user_id: "u-head" }), teams, "2099-01-01")).toEqual(["Department head of Programming"]);
  });
  it("combines roles when a PM also heads a team", () => {
    expect(roleLabels(p({ role: "pm", user_id: "u-pm" }), teams, "2099-01-01")).toEqual(["Project Manager", "Department head of Content"]);
  });
  it("shows temporary leadership with its end date and says when it has ended (date-only compare)", () => {
    const acting = p({ role: "acting_pm", acting_until: "2099-03-05" });
    expect(roleLabels(acting, teams, "2099-03-05")).toEqual(["Temporary leader until 5 Mar 2099"]);
    expect(isActingCurrent(acting, "2099-03-05")).toBe(true);
    expect(isActingCurrent(acting, "2099-03-06")).toBe(false);
    expect(roleLabels(acting, teams, "2099-03-06")).toEqual(["Temporary leadership ended", "Member"]);
  });
  it("finds a team name or null", () => {
    expect(teamNameOf("t1", teams)).toBe("Programming");
    expect(teamNameOf("nope", teams)).toBeNull();
    expect(teamNameOf(null, teams)).toBeNull();
  });
});
