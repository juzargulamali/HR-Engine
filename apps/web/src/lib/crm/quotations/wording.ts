/**
 * Estimate wording for text that comes from the database. The database functions (migration 20261220000100, already applied and never edited) were written
 * before the owner decided "estimate only": their refusal messages still say quotation / issue / validity date / founder's approval. Everything a person
 * reads must say Estimate, so the messages are translated here, in one place, with a test over every message the functions can raise.
 */
const RULES: [RegExp, string][] = [
  [/\bAn issued quotation\b/g, "A finalised estimate"],
  [/\ban issued quotation\b/g, "a finalised estimate"],
  [/\bOnly an issued quotation needs a revision\b/g, "Only a finalised estimate needs a revision"],
  [/\bThe validity date is in the past\b/g, "The review-pricing date is in the past"],
  [/\bvalidity date\b/gi, "review-pricing date"],
  [/\bbefore it can be issued\b/g, "before it can be finalised"],
  [/\bbefore issuing\b/g, "before finalising"],
  [/\bbilled to\b/g, "addressed to"],
  [/\ba founder's approval\b/g, "approval"],
  [/\bfounder's approval\b/gi, "approval"],
  [/\bfounder's\b/g, "the approver's"],
  [/\bunissued\b/g, "unfinalised"],
  [/\bquotations\b/g, "estimates"],
  [/\bQuotations\b/g, "Estimates"],
  [/\bquotation\b/g, "estimate"],
  [/\bQuotation\b/g, "Estimate"],
  [/\bissuing company\b/g, "company"],
  [/\bissued\b/g, "finalised"],
  [/\bIssued\b/g, "Finalised"],
  [/\bissue\b/g, "finalise"],
];

/** Rewrites a database message into estimate wording. Idempotent. Text that is not about estimates passes through unchanged. */
export function estimateWording(message: string): string {
  return RULES.reduce((m, [re, to]) => m.replace(re, to), message);
}

/** The note the database writes on an estimate's proposal row ("Estimate (quotation builder)", "Revision 2 of QUO-..."), in estimate wording. */
export function estimateNoteText(note: string): string {
  return estimateWording(note.replace(/^Estimate \(quotation builder\)$/, "Estimate"));
}
