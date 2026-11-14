import type { ActivityKind, CrewRole } from "@/lib/projects/phase2/model";
import type { SitePhase } from "@/lib/projects/site-state";

/**
 * The Operations TV board, exactly the allowlist `ops_tv_board(company)` returns (docs/operations-tv-scope.md section 3). Nothing here is read any other way: no comments,
 * links, values, HR details, phone numbers or e-mail addresses exist in these types, so none can be drawn.
 */
export type TvReadyState = "ready" | "not_ready" | "not_applicable" | "not_recorded";
export interface TvReadiness { hardware: TvReadyState | string | null; content: TvReadyState | string | null; app: TvReadyState | string | null }
export interface TvPhaseFacts { phase: SitePhase; basis: "activity" | "project_header" | "none"; first_day: string | null; last_day: string | null; started_at: string | null; choice_pending?: boolean }
export interface TvCrew { name: string; role: CrewRole | string }
export interface TvActivity {
  id: string; project_id: string; project_ref: string; project_name: string; title: string; kind: ActivityKind | null; run_label: string | null;
  state: "tentative" | "confirmed"; phase: TvPhaseFacts; venue: string | null; venue_source: "activity" | "project" | null;
  start_date: string | null; end_date: string | null; starts_at: string | null; ends_at: string | null; tz: string | null;
  lead: { name: string } | null; crew: TvCrew[]; crew_total: number; call_missing: number; readiness: TvReadiness | null;
}
export interface TvRequest { code: string; state: string; units_short?: number | null; expected_return_at?: string | null; return_overdue?: boolean | null }
export interface TvShipment {
  id: string; project_id: string; project_ref: string; project_name: string; label: string; activity_id: string | null; activity_title: string | null; run_label: string | null;
  departs_at: string | null; arrives_at: string | null; returns_at: string | null; tz: string | null; state: "tentative" | "confirmed"; request: TvRequest | null;
}
export interface TvProject {
  id: string; ref: string; name: string; status: string; kind: string; pm_name: string | null; activations: { title: string }[]; next_activity_id: string | null;
  dated_activities: number; project_readiness: TvReadiness | null; equipment: { requests: number; worst_state: string | null } | null;
}
export interface TvHandover { id: string; reference: string; title: string; status: string; pm_name: string | null; install_start: string | null; location: string | null; submitted_at: string | null }
export interface TvBoard {
  generated_at: string; access: "display" | "operations"; company: { id: string; name: string }; office_tz: string; display: { id: string; label: string } | null;
  truncated: { activities: boolean; projects: boolean; shipments: boolean };
  activities: TvActivity[]; shipments: TvShipment[]; projects: TvProject[]; handovers: TvHandover[]; notes: unknown[];
}

/** What `ops_tv_my_display()` says about the caller: null when they are not a display identity. */
export interface TvMyDisplay { id: string; company_id: string; company_name?: string | null; label: string; office_tz?: string | null; revoked_at?: string | null; revoked?: boolean }

/** The answers the refresh route gives (and the page loader), always with Cache-Control: no-store. */
export type TvLoad =
  | { state: "ok"; board: TvBoard }
  | { state: "signed_out" | "revoked" | "denied" | "not_installed" | "error" };
export type TvFailureKind = "transient" | "signed_out" | "revoked" | "denied" | "not_installed";
