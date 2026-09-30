import "server-only";

/**
 * A minimal Jibble API client — server-only, credentials never reach the
 * browser (JIBBLE_CLIENT_ID/JIBBLE_CLIENT_SECRET are read from process.env
 * here and nowhere else).
 *
 * What's independently CONFIRMED (multiple mutually corroborating secondary
 * sources — Nexla's own connector docs, the published `jibble-sdk` npm
 * package, a Microsoft Power BI community thread showing a live Bearer-token
 * exchange, and Jibble's own public API-tracker listing; docs.api.jibble.io
 * itself was unreachable both when this file was first written AND during
 * this later verification pass — this sandbox's network egress is blocked
 * for every Jibble-related and Jibble-doc-mirroring domain tried, and no
 * JIBBLE_CLIENT_ID/SECRET were available either, so live verification could
 * not run here; see the PR description's "Jibble API" section for exactly
 * what remains unverified and how to complete it once both are available):
 *   - Auth is OAuth2 client_credentials against
 *     https://identity.prod.jibble.io/connect/token (POST,
 *     application/x-www-form-urlencoded, grant_type=client_credentials +
 *     client_id + client_secret), returning a short-lived bearer
 *     access_token — re-exchanged on every call below rather than cached,
 *     since client_credentials issues no refresh_token.
 *   - Jibble's REST API is split across several prod.jibble.io
 *     subdomains and exposes an OData-style TimeEntries resource
 *     ($filter/$expand/$select/$orderby, Bearer auth).
 *
 * What is NOT independently confirmed — verify against a real sandbox/
 * tenant (see scripts/jibble-verify.ts, built for exactly this) before
 * relying on this in Production:
 *   - The exact TimeEntries base URL/path (JIBBLE_TIME_ENTRIES_URL below
 *     defaults to a best-guess `https://time-tracking.prod.jibble.io/v1/TimeEntries`
 *     — override via env if your tenant's is different).
 *   - The exact property names on a TimeEntries record (id/personId/start/
 *     end/note/break fields).
 *   - Whether an in-progress (still clocked-in) entry has a literal null
 *     end field or is simply absent from a "completed only" filter.
 *   - Whether breaks are a sub-array on the same entry or represented as
 *     separate sibling entries per day.
 *   - Whether Jibble exposes genuine push webhooks at all (only Zapier's/
 *     Pipedream's own polling-based triggers were found in research, not a
 *     documented native webhook API) — this client and the sync route it
 *     supports assume a scheduled PULL only.
 *
 * How this uncertainty is handled, on purpose:
 *
 * parseJibbleEntry() does NOT silently guess. It tries several plausible
 * candidate field names per concept (still necessary until a live tenant
 * confirms the real ones), but the moment two candidates disagree, or a
 * field is present in an unrecognized shape (e.g. a `breaks` array whose
 * items don't look like {durationMinutes} or {start,end}), or a required
 * field (id, person id, start) can't be found at all, that is recorded as
 * an explicit, structured review reason rather than defaulted away. The
 * caller (the sync route, and ultimately import_jibble_time_entry() in
 * schema.sql) NEVER computes worked hours from an entry carrying one of
 * these reasons — see sync_jibble_attendance_for_day()'s own doc comment
 * for how an ambiguous entry is excluded from a day's totals rather than
 * silently contributing a wrong number.
 */

const TOKEN_URL = process.env.JIBBLE_TOKEN_URL ?? "https://identity.prod.jibble.io/connect/token";
const TIME_ENTRIES_URL = process.env.JIBBLE_TIME_ENTRIES_URL ?? "https://time-tracking.prod.jibble.io/v1/TimeEntries";

/** A cleanly parsed entry, ready for import_jibble_time_entry() — may still
 * carry needsReview (e.g. an ambiguous break shape), in which case the
 * caller must pass that through as p_client_needs_review, never silently
 * trust breakMinutes/start/end for an hours calculation. */
export interface ParsedJibbleEntry {
  status: "parseable";
  jibbleEntryId: string;
  personId: string;
  /** ISO timestamp, or null if no recognizable start field was found (itself a needsReview reason). */
  start: string | null;
  /** ISO timestamp, or null if the shift is still open (clocked in, not an error). */
  end: string | null;
  entryStatus: "completed" | "in_progress";
  note: string | null;
  breakMinutes: number;
  needsReview: boolean;
  reviewReason: string | null;
  raw: Record<string, unknown>;
}

/** An entry with no recognizable id and/or person id at all — there is no
 * stable key to import it under, so it is never sent to
 * import_jibble_time_entry(); it is only ever reported (redacted) so a
 * human can see the sync found something it couldn't even begin to parse. */
export interface UnparseableJibbleEntry {
  status: "unparseable";
  reason: string;
  raw: Record<string, unknown>;
}

export type JibbleParseResult = ParsedJibbleEntry | UnparseableJibbleEntry;

interface FieldPick {
  value: unknown;
  matchedKey: string | null;
  /** Other candidate keys present with a DIFFERENT value than the one chosen — evidence the guessed field-name list doesn't match this tenant. */
  conflictingKeys: string[];
}

function pickField(obj: Record<string, unknown>, candidates: string[]): FieldPick {
  const present: { key: string; value: unknown }[] = [];
  for (const key of candidates) {
    if (obj[key] !== undefined && obj[key] !== null) present.push({ key, value: obj[key] });
  }
  if (present.length === 0) return { value: undefined, matchedKey: null, conflictingKeys: [] };
  const first = present[0]!;
  const conflictingKeys = present.slice(1).filter((p) => JSON.stringify(p.value) !== JSON.stringify(first.value)).map((p) => p.key);
  return { value: first.value, matchedKey: first.key, conflictingKeys };
}

function resolveBreakMinutes(raw: Record<string, unknown>): { minutes: number; ambiguous: boolean; reason: string | null } {
  const direct = pickField(raw, ["breakMinutes", "BreakMinutes", "breakDurationMinutes"]);
  if (typeof direct.value === "number") {
    if (direct.conflictingKeys.length > 0) {
      return { minutes: direct.value, ambiguous: true, reason: `Break-minutes fields disagree (${direct.matchedKey} vs ${direct.conflictingKeys.join(", ")}).` };
    }
    return { minutes: direct.value, ambiguous: false, reason: null };
  }

  const breaksField = pickField(raw, ["breaks", "Breaks"]);
  if (breaksField.value === undefined) {
    // No breaks-like field present at all — legitimately zero, not an unknown.
    return { minutes: 0, ambiguous: false, reason: null };
  }
  if (!Array.isArray(breaksField.value)) {
    return { minutes: 0, ambiguous: true, reason: `Breaks field (${breaksField.matchedKey}) is present but not an array or number — cannot compute break time.` };
  }

  let total = 0;
  let anyUnrecognized = false;
  for (const entry of breaksField.value) {
    if (entry && typeof entry === "object") {
      const minutes = pickField(entry as Record<string, unknown>, ["durationMinutes", "DurationMinutes", "minutes"]);
      if (typeof minutes.value === "number") {
        total += minutes.value;
        continue;
      }
      const start = pickField(entry as Record<string, unknown>, ["start", "Start", "startTime"]);
      const end = pickField(entry as Record<string, unknown>, ["end", "End", "endTime"]);
      if (typeof start.value === "string" && typeof end.value === "string") {
        const ms = Date.parse(end.value) - Date.parse(start.value);
        if (Number.isFinite(ms) && ms > 0) {
          total += ms / 60000;
          continue;
        }
      }
    }
    anyUnrecognized = true;
  }
  if (anyUnrecognized) {
    return { minutes: 0, ambiguous: true, reason: "One or more entries in the breaks array did not match a recognized shape (duration or start/end)." };
  }
  return { minutes: Math.round(total * 100) / 100, ambiguous: false, reason: null };
}

/**
 * Parses one raw Jibble API record into a structured result — never throws,
 * never silently returns a plausible-looking-but-wrong entry. See this
 * file's own header for the overall "fail closed" design.
 */
export function parseJibbleEntry(raw: Record<string, unknown>): JibbleParseResult {
  const idField = pickField(raw, ["id", "Id", "ID"]);
  const personField = pickField(raw, ["personId", "PersonId", "memberId", "MemberId"]);
  if (typeof idField.value !== "string" || typeof personField.value !== "string") {
    return { status: "unparseable", reason: "No recognizable id and/or person id field on this record.", raw };
  }

  const reasons: string[] = [];
  if (idField.conflictingKeys.length > 0) reasons.push(`Multiple id-like fields disagree (${idField.matchedKey} vs ${idField.conflictingKeys.join(", ")}).`);
  if (personField.conflictingKeys.length > 0) reasons.push(`Multiple person-id-like fields disagree (${personField.matchedKey} vs ${personField.conflictingKeys.join(", ")}).`);

  const startField = pickField(raw, ["start", "Start", "in", "In", "clockIn", "startTime"]);
  let start: string | null = null;
  if (typeof startField.value !== "string") {
    reasons.push("No recognizable start-time field.");
  } else if (Number.isNaN(Date.parse(startField.value))) {
    reasons.push(`Start-time field (${startField.matchedKey}) is not a parseable timestamp: "${startField.value}".`);
  } else {
    start = startField.value;
  }
  if (startField.conflictingKeys.length > 0) reasons.push(`Multiple start-time-like fields disagree (${startField.matchedKey} vs ${startField.conflictingKeys.join(", ")}).`);

  const endField = pickField(raw, ["end", "End", "out", "Out", "clockOut", "endTime"]);
  let end: string | null = null;
  if (typeof endField.value === "string") {
    if (Number.isNaN(Date.parse(endField.value))) {
      reasons.push(`End-time field (${endField.matchedKey}) is not a parseable timestamp: "${endField.value}".`);
    } else {
      end = endField.value;
    }
  }
  if (endField.conflictingKeys.length > 0) reasons.push(`Multiple end-time-like fields disagree (${endField.matchedKey} vs ${endField.conflictingKeys.join(", ")}).`);

  const noteField = pickField(raw, ["note", "Note", "notes", "comment"]);
  const note = typeof noteField.value === "string" ? noteField.value : null;
  if (noteField.conflictingKeys.length > 0) {
    reasons.push(`Multiple note-like fields disagree (${noteField.matchedKey} vs ${noteField.conflictingKeys.join(", ")}) — used ${noteField.matchedKey}, but confirm the real field against a live tenant.`);
  }

  const breaks = resolveBreakMinutes(raw);
  if (breaks.ambiguous && breaks.reason) reasons.push(breaks.reason);

  return {
    status: "parseable",
    jibbleEntryId: idField.value,
    personId: personField.value,
    start,
    end,
    entryStatus: end ? "completed" : "in_progress",
    note,
    breakMinutes: breaks.minutes,
    needsReview: reasons.length > 0,
    reviewReason: reasons.length > 0 ? reasons.join(" ") : null,
    raw,
  };
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.JIBBLE_CLIENT_ID;
  const clientSecret = process.env.JIBBLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("JIBBLE_CLIENT_ID/JIBBLE_CLIENT_SECRET are not configured.");
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!response.ok) {
    throw new Error(`Jibble token request failed: ${response.status} ${await response.text()}`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error("Jibble token response had no access_token.");
  }
  return body.access_token;
}

export interface FetchResult {
  parsed: ParsedJibbleEntry[];
  unparseable: UnparseableJibbleEntry[];
  /** True if pagination stopped early because a page request failed — the
   * caller must treat this run as 'partial': import whatever was fetched
   * (safe, since import_jibble_time_entry() is idempotent), but must NOT
   * advance the sync checkpoint past this window, so the next run retries
   * the whole range rather than silently skipping what the failed page held. */
  failedPage: boolean;
  failureMessage: string | null;
  pagesFetched: number;
}

/**
 * Fetches every TimeEntries record whose start falls within
 * [sinceIso, untilIso) for one Jibble organization, one page at a time
 * (standard OData `$top`/`@odata.nextLink`-style paging — see this file's
 * own header on what's confirmed vs. assumed about the exact shape).
 *
 * Never throws on a single malformed row (parseJibbleEntry() handles that).
 * DOES stop and report failedPage=true if a page request itself fails
 * (network error, non-2xx, malformed JSON) rather than throwing — a
 * partial result (everything fetched before the failure) is still
 * returned and is still safe to import, since it's a strict subset of an
 * idempotent operation; the caller is responsible for not advancing its
 * sync checkpoint past this run when failedPage is true, so the failed
 * range is retried on the next run instead of silently dropped.
 */
export async function fetchJibbleTimeEntries(sinceIso: string, untilIso: string): Promise<FetchResult> {
  const parsed: ParsedJibbleEntry[] = [];
  const unparseable: UnparseableJibbleEntry[] = [];
  let pagesFetched = 0;

  let token: string;
  try {
    token = await getAccessToken();
  } catch (err) {
    return {
      parsed,
      unparseable,
      failedPage: true,
      failureMessage: `Authentication failed: ${err instanceof Error ? err.message : String(err)}`,
      pagesFetched,
    };
  }

  let url: string | null =
    `${TIME_ENTRIES_URL}?$filter=start ge ${encodeURIComponent(sinceIso)} and start lt ${encodeURIComponent(untilIso)}&$top=200`;

  while (url) {
    let response: Response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    } catch (err) {
      return { parsed, unparseable, failedPage: true, failureMessage: `Network error fetching page ${pagesFetched + 1}: ${err instanceof Error ? err.message : String(err)}`, pagesFetched };
    }
    if (!response.ok) {
      return { parsed, unparseable, failedPage: true, failureMessage: `Jibble TimeEntries request failed on page ${pagesFetched + 1}: ${response.status} ${await response.text()}`, pagesFetched };
    }

    let body: { value?: Record<string, unknown>[]; "@odata.nextLink"?: string };
    try {
      body = await response.json();
    } catch (err) {
      return { parsed, unparseable, failedPage: true, failureMessage: `Could not parse page ${pagesFetched + 1} as JSON: ${err instanceof Error ? err.message : String(err)}`, pagesFetched };
    }

    for (const raw of body.value ?? []) {
      const result = parseJibbleEntry(raw);
      if (result.status === "parseable") parsed.push(result);
      else unparseable.push(result);
    }
    pagesFetched += 1;
    url = body["@odata.nextLink"] ?? null;
  }

  return { parsed, unparseable, failedPage: false, failureMessage: null, pagesFetched };
}
