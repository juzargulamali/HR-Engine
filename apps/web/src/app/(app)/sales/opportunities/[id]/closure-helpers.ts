import { CRM_PIPELINE_STAGES, crmStageLabel, type CrmStageId } from "@enginious-hr/domain";
import { formatMoney } from "@/components/sales/format";
import type { CrmClosureRow, CrmOpportunityEventRow } from "@/types/crm";

/**
 * Pure helpers for reopening and for the closure history (no React, no server-only imports) so they can be unit tested.
 * Mirrors crm_reopen_opportunity: it returns to the stage it was closed from, or 'negotiation' when none was recorded.
 */

export const REOPEN_FALLBACK_STAGE: CrmStageId = "negotiation";

export const HANDOVER_REOPENED_NOTICE =
  "This opportunity was reopened after its handover was prepared. The handover record is kept as it was; check it again when the opportunity is Won again.";

export const REOPEN_NOT_ALLOWED_NOTE = "Only a founder, or someone a founder gave the reopen right to, can reopen this.";

/** The working stage a reopened opportunity goes back to unless another is chosen. */
export function defaultReopenStage(stageBeforeClose: string | null | undefined): CrmStageId {
  return CRM_PIPELINE_STAGES.find((s) => s === stageBeforeClose) ?? REOPEN_FALLBACK_STAGE;
}

export interface ReopenStageOption {
  id: CrmStageId;
  label: string;
  isDefault: boolean;
}

/** The six working stages (never On hold, Won or Lost); the default is labelled as where it was closed from. */
export function reopenStageOptions(stageBeforeClose: string | null | undefined): ReopenStageOption[] {
  const def = defaultReopenStage(stageBeforeClose);
  const recorded = CRM_PIPELINE_STAGES.some((s) => s === stageBeforeClose);
  return CRM_PIPELINE_STAGES.map((id) => ({
    id,
    isDefault: id === def,
    label: id === def ? `${crmStageLabel(id)} (${recorded ? "where it was closed from" : "default; no earlier stage was recorded"})` : crmStageLabel(id),
  }));
}

const EVIDENCE_LABEL: Record<string, string> = { purchase_order: "Purchase order", authorised_email: "Authorised email" };
export const evidenceTypeLabel = (t: string | null | undefined): string => (t ? (EVIDENCE_LABEL[t] ?? t.replace(/_/g, " ")) : "Evidence");

export interface ClosureView {
  id: string;
  outcome: "won" | "lost";
  /** Only a closure that has not been reopened describes the opportunity today. */
  status: "current" | "reopened";
  /** "Won" / "Lost" while current; "Was won" / "Was lost" once reopened, so it never reads as the present outcome. */
  heading: string;
  closedAt: string;
  closedLine: string;
  valueText: string | null;
  /** The evidence (won) or the reason (lost), one labelled line each. */
  details: { label: string; text: string }[];
  reopened: { at: string; line: string; reason: string | null } | null;
}

/** Newest first by when it was closed (the database already orders them; this keeps the guarantee local and stable). */
export function sortClosures(closures: readonly CrmClosureRow[]): CrmClosureRow[] {
  return [...closures].sort((a, b) => new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime());
}

export function describeClosures(
  closures: readonly CrmClosureRow[],
  personName: (id: string | null | undefined) => string,
  formatDate: (value: string) => string,
): ClosureView[] {
  return sortClosures(closures).map((c) => {
    const reopened = !!c.reopened_at;
    const value = c.value_at_close == null || c.value_at_close === "" ? null : Number(c.value_at_close);
    const details: ClosureView["details"] = [];
    if (c.outcome === "won") {
      const ref = [evidenceTypeLabel(c.evidence_type), c.evidence_reference].filter(Boolean).join(" ");
      details.push({ label: "Confirmed by", text: `${ref}${c.evidence_date ? `, dated ${formatDate(c.evidence_date)}` : ""}` });
    } else if (c.lost_reason) {
      details.push({ label: "Reason", text: c.lost_reason });
    }
    return {
      id: c.id,
      outcome: c.outcome,
      status: reopened ? "reopened" : "current",
      heading: reopened ? `Was ${c.outcome}` : c.outcome === "won" ? "Won" : "Lost",
      closedAt: c.closed_at,
      closedLine: `${c.outcome === "won" ? "Marked Won" : "Marked Lost"} by ${personName(c.closed_by)}`,
      valueText: value != null && Number.isFinite(value) ? formatMoney(value, c.currency ?? "").trim() : null,
      details,
      reopened: c.reopened_at ? { at: c.reopened_at, line: `Reopened by ${personName(c.reopened_by)}`, reason: c.reopen_reason } : null,
    };
  });
}

const CONTACT_FIELD_LABELS: Record<string, string> = { name: "name", role_title: "job title", email: "email", phone: "phone", organisation_id: "organisation" };

/**
 * Sentences for the timeline rows of kind `reopened` and `contact`; null for every other kind (use describeEvent).
 * Row shapes: crm_reopen_opportunity (from = closed stage, to = new stage, reason = why) and crm_link_contact /
 * crm_unlink_contact / crm_update_contact (from/to = names, reason = what happened).
 */
export function describeHistoryEvent(e: Pick<CrmOpportunityEventRow, "kind" | "from_value" | "to_value" | "reason">): string | null {
  if (e.kind === "reopened") {
    const was = e.from_value ? `${crmStageLabel(e.from_value)} opportunity` : "closed opportunity";
    return `Reopened: the ${was} went back to ${e.to_value ? crmStageLabel(e.to_value) : "a working stage"}.${e.reason ? ` Reason: ${e.reason}.` : ""}`;
  }
  if (e.kind === "contact") {
    const reason = e.reason ?? "";
    if (reason.startsWith("Contact unlinked")) return `Contact removed from this opportunity: ${e.from_value ?? "someone"}. The contact record itself is kept.`;
    if (reason.startsWith("Contact role updated")) return `Contact role changed: ${e.to_value ?? ""}.`;
    if (reason.startsWith("Contact linked")) return `Contact added to this opportunity: ${e.to_value ?? ""}.`;
    if (reason.startsWith("Contact details updated")) {
      const m = /\(([^)]*)\)/.exec(reason);
      const fields = (m?.[1] ?? "").split(", ").filter(Boolean).map((f) => CONTACT_FIELD_LABELS[f] ?? f);
      const who = e.from_value && e.to_value && e.from_value !== e.to_value ? `${e.from_value}, now ${e.to_value}` : (e.to_value ?? e.from_value ?? "a contact");
      return `Shared contact record updated for ${who}${fields.length ? ` (${fields.join(", ")})` : ""}. The change applies everywhere this person appears.`;
    }
    return `Contact: ${[e.from_value, e.to_value].filter(Boolean).join(" to ")}${reason ? `. ${reason}` : ""}.`;
  }
  return null;
}
