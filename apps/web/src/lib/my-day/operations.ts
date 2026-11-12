import { PackageSearch, MessageSquareReply } from "lucide-react";
import type { OpsResult } from "@/lib/operations/data";
import { DECISION_WORDS, decisions, installationsWithin, projectHealth, type DecisionKind, type Health, type Overview, type UpcomingRow } from "@/lib/operations/model";
import type { AttentionCandidate } from "./attention";
import { waitingAgeText } from "./waiting";

/**
 * Operations on My Day. Pure: it only reshapes what the two Operations reads returned for each company the person is Operations Manager of (the database
 * checks the company on every read), so there is no second copy of the data and nothing here can widen what they see. No commercial field exists in those reads.
 *
 * Two different things come out of it:
 *   the summary     what Operations oversees (decisions waiting, the next installations, the most urgent recorded issue), each with its owner named;
 *   the candidates  only what THIS person can act on now, for "What needs my attention". A handover to assign is not repeated here: the Projects source
 *                   already lists it once per handover, for everyone who may assign.
 */
export interface OpsCompanyRead { company: { id: string; name: string }; overview: OpsResult<Overview>; upcoming: OpsResult<UpcomingRow[]> }
export interface OpsDay { reads: OpsCompanyRead[] }

export interface OpsDaySummary {
  /** How many recorded situations wait for a decision in the companies that loaded. Null when none of them loaded: never zero for a failed read. */
  decisions: number | null;
  decisionsHref: string;
  installations: { key: string; title: string; date: string; inDays: number; by: "installation" | "show"; pm: string; health: Health; href: string }[];
  installationsTotal: number;
  urgent: null | { kind: DecisionKind; label: string; title: string; detail: string; owner: string; href: string };
  /** Companies whose Operations read failed. They are named on the card. */
  failed: string[];
  multi: boolean;
}
export const OPS_DAY_INSTALLATIONS = 3;

export function opsDaySummary(day: OpsDay, today: string): OpsDaySummary {
  const loaded = day.reads.filter((r): r is OpsCompanyRead & { overview: { state: "ok"; data: Overview } } => r.overview.state === "ok");
  const failed = day.reads.filter((r) => r.overview.state === "error").map((r) => r.company.name);
  const multi = day.reads.length > 1;
  const tag = (name: string) => (multi ? ` · ${name}` : "");
  const all = loaded.flatMap((r) => decisions(r.overview.data, today).map((d) => ({ d, company: r.company })));
  const installs = loaded.flatMap((r) => installationsWithin(r.overview.data, today).map((p) => ({
    key: p.id, title: `${p.reference} ${p.name}${tag(r.company.name)}`, date: p.start, inDays: p.in_days, by: p.by, pm: p.pm, health: projectHealth(p, today).health, href: `/projects/${p.id}/work`,
  }))).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  const first = loaded.length === 1 ? loaded[0]!.company.id : null;
  // The decisions of each company are already in order of urgency; across companies the same order applies.
  const order = Object.keys(DECISION_WORDS) as DecisionKind[];
  const top = [...all].sort((a, b) => order.indexOf(a.d.kind) - order.indexOf(b.d.kind) || (a.d.date ?? "9999").localeCompare(b.d.date ?? "9999"))[0];
  return {
    decisions: loaded.length === 0 ? null : all.length,
    decisionsHref: first ? `/operations?company=${first}#decisions` : top ? `/operations?company=${top.company.id}#decisions` : "/operations",
    installations: installs.slice(0, OPS_DAY_INSTALLATIONS), installationsTotal: installs.length,
    urgent: top ? { kind: top.d.kind, label: DECISION_WORDS[top.d.kind], title: `${top.d.title}${tag(top.company.name)}`, detail: top.d.detail, owner: top.d.owner, href: top.d.href } : null,
    failed, multi,
  };
}

/** A Sales answer stays on "What needs my attention" for this many days after it was given (or until Operations changes the question, which clears the answer). */
export const OPS_ANSWER_DAYS = 7;
/**
 * What an Operations Manager can act on now that no other source lists: Sales answered a question Operations asked on a flagged enquiry, so the planning
 * decision is back with Operations. One item per enquiry, keyed like every other item about that enquiry (`opp:<id>`), so it merges with them.
 */
export function opsAnswerCandidates(day: OpsDay, now: Date): AttentionCandidate[] {
  const out: AttentionCandidate[] = [];
  for (const r of day.reads) {
    if (r.upcoming.state !== "ok") continue;
    for (const row of r.upcoming.data) {
      const p = row.planning;
      if (!p?.question || !p.answer || !p.answered_at || row.handover?.project_id) continue;
      if (now.getTime() - Date.parse(p.answered_at) > OPS_ANSWER_DAYS * 86_400_000) continue;
      out.push({
        key: `opp:${row.id}`, source: "operations", icon: MessageSquareReply, title: row.title, context: row.reference, what: "Sales answered the Operations question: decide the planning",
        ...(waitingAgeText(p.answered_at, now) ? { when: waitingAgeText(p.answered_at, now)! } : {}), tier: 2, at: p.answered_at, href: `/operations/upcoming?company=${row.company_id}&q=${encodeURIComponent(row.reference)}`,
      });
    }
  }
  return out;
}
/** True when an Operations read that feeds the candidates failed for any company: the attention list then names Operations as not loaded. */
export const opsCandidatesFailed = (day: OpsDay) => day.reads.some((r) => r.upcoming.state === "error");

export interface MyEquipmentReview { projectId: string; reference: string; name: string; count: number; since: string }
/** "Review equipment booking" on the projects this person manages: the Project Manager's action, one item per project. */
export function equipmentReviewCandidates(rows: readonly MyEquipmentReview[], now: Date): AttentionCandidate[] {
  return rows.map((r) => ({
    key: `equipment-review:${r.projectId}`, source: "project-equipment", icon: PackageSearch, title: `${r.reference} ${r.name}`,
    what: r.count === 1 ? "Review equipment booking: a committed date changed" : `Review ${r.count} equipment bookings: committed dates changed`,
    ...(waitingAgeText(r.since, now) ? { when: waitingAgeText(r.since, now)! } : {}), tier: 2, at: r.since, href: `/projects/${r.projectId}/equipment`,
  }));
}
