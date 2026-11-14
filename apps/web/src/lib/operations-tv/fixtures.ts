import type { TvActivity, TvBoard, TvProject, TvShipment } from "./types";

/** Fictional board builders for the unit tests (and nothing else). */
export const act = (o: Partial<TvActivity> = {}): TvActivity => ({
  id: "a1", project_id: "p1", project_ref: "PRJ-1", project_name: "RAF Fictional Expo", title: "Installation", kind: "setup", run_label: null, state: "confirmed",
  phase: { phase: "scheduled", basis: "activity", first_day: "2026-11-17", last_day: "2026-11-17", started_at: null }, venue: "Fictional Hall 3", venue_source: "activity",
  start_date: "2026-11-17", end_date: "2026-11-17", starts_at: "2026-11-17T03:00:00Z", ends_at: "2026-11-17T15:00:00Z", tz: "Asia/Dubai", lead: { name: "Mona Manager" },
  crew: [{ name: "Tariq Technician", role: "installation" }], crew_total: 1, call_missing: 0, readiness: { hardware: "ready", content: "ready", app: "not_applicable" }, ...o,
});
export const ship = (o: Partial<TvShipment> = {}): TvShipment => ({
  id: "s1", project_id: "p1", project_ref: "PRJ-1", project_name: "RAF Fictional Expo", label: "Kit crate", activity_id: "a1", activity_title: "Installation", run_label: null,
  departs_at: "2026-11-15T05:00:00Z", arrives_at: "2026-11-16T05:00:00Z", returns_at: null, tz: "Asia/Dubai", state: "confirmed", request: null, ...o,
});
export const proj = (o: Partial<TvProject> = {}): TvProject => ({
  id: "p1", ref: "PRJ-1", name: "RAF Fictional Expo", status: "active", kind: "client", pm_name: "Mona Manager", activations: [{ title: "Welcome wall" }], next_activity_id: "a1", dated_activities: 1,
  project_readiness: { hardware: "not_recorded", content: "not_recorded", app: "not_recorded" }, equipment: { requests: 1, worst_state: "reserved" }, ...o,
});
export const board = (o: Partial<TvBoard> = {}): TvBoard => ({
  generated_at: "2026-11-14T08:00:00Z", access: "display", company: { id: "c1", name: "Enginious LLC FZ" }, office_tz: "Asia/Dubai", display: { id: "d1", label: "Office TV" },
  truncated: { activities: false, projects: false, shipments: false }, activities: [act()], shipments: [], projects: [proj()], handovers: [], notes: [], ...o,
});
