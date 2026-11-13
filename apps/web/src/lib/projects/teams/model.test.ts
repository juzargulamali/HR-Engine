import { describe, expect, it } from "vitest";
import { accessAdditions, buildSetup, leadLabel, leadNeeded, setupNotice, setupState, TEAM_PRESETS } from "./model";

const team = (name: string, head: string | null) => ({ id: name, name, head_user_id: head });

describe("project team setup model", () => {
  it("names a lead by its team so leads are easy to identify", () => {
    expect(leadLabel("Programming")).toBe("Programming Lead");
    expect(leadLabel(" Site / Installation ")).toBe("Site / Installation Lead");
  });
  it("offers the four presets, and Site / Installation says it enrols nobody", () => {
    expect(TEAM_PRESETS.map((p) => p.name)).toEqual(["Content", "Programming", "Engineering", "Site / Installation"]);
    expect(TEAM_PRESETS.find((p) => p.key === "site_installation")!.hint).toMatch(/not enrolled|per activity/);
  });
  it("setup is the first step until a team exists; teams without a lead are flagged", () => {
    expect(setupState([])).toBe("none");
    expect(setupState([team("Content", null), team("Programming", "u1")])).toBe("lead_needed");
    expect(leadNeeded([team("Content", null), team("Programming", "u1")])).toEqual(["Content"]);
    expect(setupState([team("Content", "u2")])).toBe("complete");
  });
  it("builds only the selected teams, with the lead chosen for each, and a lead may be left unknown", () => {
    const rows = buildSetup({ presets: ["content", "programming"], custom: ["Lighting"], leads: { Programming: "u1" } }, []);
    expect(rows).toEqual([{ name: "Content", preset: "content" }, { name: "Programming", preset: "programming", lead_user_id: "u1" }, { name: "Lighting" }]);
  });
  it("never repeats a team or replaces an existing lead; only a missing lead can be filled", () => {
    const existing = [team("Content", "u9"), team("Programming", null)];
    const rows = buildSetup({ presets: ["content", "programming"], custom: ["  programming ", "content"], leads: { Content: "u1", Programming: "u2" } }, existing);
    expect(rows).toEqual([{ name: "Programming", lead_user_id: "u2" }]);                 // Content has a lead already: left out entirely
    expect(buildSetup({ presets: [], custom: [], leads: { Programming: "u2" } }, existing)).toEqual([{ name: "Programming", lead_user_id: "u2" }]);
    expect(buildSetup({ presets: [], custom: [], leads: {} }, existing)).toEqual([]);    // nothing chosen: nothing to save
  });
  it("names the people who would be added to the project before saving", () => {
    const rows = [{ name: "Content", lead_user_id: "u1" }, { name: "Programming", lead_user_id: "u2" }, { name: "Lighting", lead_user_id: "u1" }, { name: "Site" }];
    expect(accessAdditions(rows, new Set(["u2"]), (id) => `Name ${id}`)).toEqual([{ id: "u1", name: "Name u1" }]);
  });
  it("says what happened after saving and who still needs a lead", () => {
    expect(setupNotice({ created: 2, members_added: 1, lead_needed: ["Content"] })).toBe("2 teams created; 1 person added to the project. Lead needed: Content.");
    expect(setupNotice({ created: 0, existing: 2, lead_needed: [] })).toBe("Those teams were already on the project, so nothing was added twice.");
    expect(setupNotice({ leads_set: 1 })).toBe("1 lead set.");
  });
});
