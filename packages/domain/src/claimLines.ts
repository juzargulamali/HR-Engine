// Reimbursement claim line numbers. A claim's lines are unique on (claim_id, line_no) and a line can be deleted,
// so the next number is never a head-count: it is the highest existing number plus one. Two people (or two
// clicks) adding at the same moment can both read the same highest number; the database then refuses the second
// insert with a unique violation, and the right response is to read again and try the next number, a bounded
// number of times, never to show the raw database error.

/** Postgres SQLSTATE for unique_violation, as PostgREST returns it in `error.code`. */
export const UNIQUE_VIOLATION_CODE = "23505";

export const CLAIM_LINE_MAX_ATTEMPTS = 8;

export type ClaimLineStore = {
  /** Highest line_no currently stored for the claim (null when the claim has no lines). */
  highestLineNo(): Promise<{ value: number | null; error: string | null }>;
  /** Insert the line with the given number. A unique conflict must carry `code: "23505"`. */
  insertLine(lineNo: number): Promise<{ error: { code?: string | null; message: string } | null }>;
};

export type AddClaimLineResult =
  | { ok: true; lineNo: number; attempts: number }
  | { ok: false; reason: "conflict" | "error"; message: string };

export const CLAIM_LINE_CONFLICT_MESSAGE =
  "Several lines were added at the same moment and this one could not be numbered. Nothing was lost on the page: press Add line again.";

/**
 * Adds one line under the next free number. Retries on a unique conflict (another add won the number) up to
 * `maxAttempts` times with a short randomised pause; any other error is returned at once, unchanged in meaning.
 */
export async function addNumberedClaimLine(
  store: ClaimLineStore,
  options: { maxAttempts?: number; pause?: (attempt: number) => Promise<void> } = {},
): Promise<AddClaimLineResult> {
  const maxAttempts = options.maxAttempts ?? CLAIM_LINE_MAX_ATTEMPTS;
  const pause =
    options.pause ?? ((attempt: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.random() * 15 * attempt)));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const highest = await store.highestLineNo();
    if (highest.error) return { ok: false, reason: "error", message: highest.error };
    const lineNo = (highest.value ?? 0) + 1;

    const { error } = await store.insertLine(lineNo);
    if (!error) return { ok: true, lineNo, attempts: attempt };
    if (error.code !== UNIQUE_VIOLATION_CODE) return { ok: false, reason: "error", message: error.message };
    if (attempt < maxAttempts) await pause(attempt);
  }
  return { ok: false, reason: "conflict", message: CLAIM_LINE_CONFLICT_MESSAGE };
}
