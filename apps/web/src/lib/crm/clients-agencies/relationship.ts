import type { EnquiryStats } from "./account";

/**
 * The ONE relationship badge of an account in the directory. Precedence, first match wins:
 *  1. none     "No enquiries recorded": no linked enquiry at all;
 *  2. dormant  "Dormant": the newest linked enquiry was recorded DORMANT_DAYS or more days ago (Dubai calendar days) AND no linked enquiry is open;
 *  3. won      "Won work": at least one linked enquiry is in stage Won (a project in progress or completed is a different thing and is not looked at);
 *  4. no_wins  "No wins yet".
 * Open and won are the account page's own definitions (`isOpenStage`, `isWonStage`).
 */
export const DORMANT_DAYS = 90;
export type Relationship = "won" | "no_wins" | "none" | "dormant";
export const RELATIONSHIPS: readonly Relationship[] = ["won", "no_wins", "none", "dormant"];

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  won: "Won work", no_wins: "No wins yet", none: "No enquiries recorded", dormant: "Dormant",
};
export const RELATIONSHIP_TONE: Record<Relationship, "green" | "amber" | "neutral" | "purple"> = { won: "green", no_wins: "amber", none: "neutral", dormant: "purple" };
export const RELATIONSHIP_HELP = `Dormant = last enquiry ${DORMANT_DAYS}+ days ago and no open enquiry. Won work = at least one recorded win. Shown in this order: No enquiries recorded, Dormant, Won work, No wins yet.`;
/** Each badge in a sentence, for the help beside the word. These restate `relationshipOf` below: change them together. */
export const RELATIONSHIP_DEFINITION: Record<Relationship, string> = {
  none: "No enquiry of this company names the account as its agency or its end client.",
  dormant: `The newest linked enquiry was recorded ${DORMANT_DAYS} or more days ago (Dubai calendar days) and no linked enquiry is open. An enquiry is open until it is won or lost, so On hold counts as open.`,
  won: "At least one linked enquiry is recorded as won. A project in progress or a completed project is a different thing and is not looked at.",
  no_wins: "The account has linked enquiries, none of them is recorded as won, and it is not Dormant.",
};
/** The order the rules are tried in: the first that fits is the one badge shown. */
export const RELATIONSHIP_PRECEDENCE: readonly Relationship[] = ["none", "dormant", "won", "no_wins"];
/** Sort order of the badge column. */
export const RELATIONSHIP_RANK: Record<Relationship, number> = { won: 0, no_wins: 1, dormant: 2, none: 3 };

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD, Dubai days). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `todayDubai` is the Dubai calendar day (YYYY-MM-DD) the page is rendered on. */
export function relationshipOf(stats: EnquiryStats, todayDubai: string): Relationship {
  if (stats.total === 0) return "none";
  if (stats.open === 0 && stats.lastEnquiryOn !== null && daysBetween(stats.lastEnquiryOn, todayDubai) >= DORMANT_DAYS) return "dormant";
  if (stats.won > 0) return "won";
  return "no_wins";
}
