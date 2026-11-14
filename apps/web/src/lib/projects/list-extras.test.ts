import { describe, expect, it } from "vitest";
import { buildActivityPreviews, noCommitmentText, pickNextCommitment, siteRowHref, teamStanding } from "./list-extras";
import type { SiteActivityRead } from "@/lib/projects/phase2/model";

type PhasePatch = Partial<SiteActivityRead["phase"]>;
const act = (over: { id?: string; project_id?: string; phase?: PhasePatch } = {}): SiteActivityRead => ({
  id: over.id ?? "a1", project_id: over.project_id ?? "p1", reference: "UAE-P-1", project_name: "Show", project_status: "in_progress", title: "Setup", kind: "setup", run_label: null, state: "tentative",
  start_date: null, end_date: null, starts_at: null, ends_at: null, tz: null, effective: {} as SiteActivityRead["effective"], owner_name: null, crew_total: 0, call_missing: 0, actual_started_at: null,
  phase: { phase: "scheduled", basis: "activity", first_day: "2026-11-20", last_day: "2026-11-20", started_at: null, kind: "setup", state: "tentative", today: "2026-11-13", ...over.phase },
});

describe("pickNextCommitment", () => {
  it("offers the earliest dated activity with the shared wording and an exact-row link", () => {
    const c = pickNextCommitment("p1", [act({ id: "a2", phase: { first_day: "2026-12-01", last_day: "2026-12-01" } }), act({ id: "a1", phase: { first_day: "2026-11-20", last_day: "2026-11-20" } })], undefined, "2026-11-13")!;
    expect(c.text).toBe("Tentative Setup on 20 Nov");
    expect(c.href).toBe(siteRowHref("p1", "a1"));
  });
  it("never says started from a passed date; it asks for action instead", () => {
    const c = pickNextCommitment("p1", [act({ phase: { phase: "date_passed", first_day: "2026-11-10", last_day: "2026-11-10" } })], { title: "Sign-off", due: "2026-11-30" }, "2026-11-13")!;
    expect(c.text).toMatch(/date passed · start unconfirmed/);
    expect(c.text).not.toMatch(/started \d/);
    expect(c.needsAction).toBe(true);
  });
  it("uses an earlier milestone, ignores undated activities and other projects", () => {
    const undated = act({ phase: { phase: "no_date", first_day: null, last_day: null, basis: "none" } });
    const other = act({ id: "x", project_id: "p2", phase: { first_day: "2026-11-14", last_day: "2026-11-14" } });
    const c = pickNextCommitment("p1", [undated, other, act({ phase: { first_day: "2026-12-05", last_day: "2026-12-05" } })], { title: "Moodboard", due: "2026-11-18" }, "2026-11-13")!;
    expect(c.kind).toBe("milestone");
    expect(pickNextCommitment("p1", [undated], undefined, "2026-11-13")).toBeNull();
  });
  it("names who sets dates when there are none", () => {
    expect(noCommitmentText("Dawood").detail).toContain("Dawood");
  });
});

describe("teamStanding", () => {
  it("tells missing leads from an empty membership", () => {
    expect(teamStanding(0, 5).label).toBe("Team leads not set");
    expect(teamStanding(2, 1).label).toBe("No other members yet");
    expect(teamStanding(2, 4).label).toBeNull();
  });
});

describe("buildActivityPreviews", () => {
  it("merges the newest events per project and counts the rest", () => {
    const row = (id: number, field: string) => ({ id, project_id: "p1", entity_type: "project", entity_id: "p1", field, from_value: "2026-11-01", to_value: "2026-11-02", note: null, actor_id: null });
    const m = buildActivityPreviews([row(3, "install_start"), row(2, "event_start"), row(1, "event_end")], () => "Someone");
    expect(m.get("p1")!.lines).toHaveLength(2);
    expect(m.get("p1")!.more).toBe(1);
  });
});
