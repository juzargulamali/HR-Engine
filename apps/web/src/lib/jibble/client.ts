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
 * itself was unreachable from the environment this was written in — see the
 * PR description's "Jibble API" section for the full trace):
 *   - Auth is OAuth2 client_credentials against
 *     https://identity.prod.jibble.io/connect/token (POST,
 *     application/x-www-form-urlencoded, grant_type=client_credentials +
 *     client_id + client_secret), returning a short-lived bearer
 *     access_token — re-exchanged on every call below rather than cached,
 *     since client_credentials issues no refresh_token and this sync only
 *     runs once an hour at most (see the cron schedule) — not worth the
 *     complexity of a token cache for that cadence.
 *   - Jibble's REST API is split across several prod.jibble.io
 *     subdomains and exposes an OData-style TimeEntries resource
 *     ($filter/$expand/$select/$orderby, Bearer auth).
 *
 * What is NOT independently confirmed — verify against a real sandbox/
 * tenant before relying on this in Production, and adjust the constants
 * and field-mapping below accordingly:
 *   - The exact TimeEntries base URL/path (JIBBLE_TIME_ENTRIES_URL below
 *     defaults to a best-guess `https://time-tracking.prod.jibble.io/v1/TimeEntries`
 *     — override via env if your tenant's is different).
 *   - The exact property names on a TimeEntries record (id/personId/start/
 *     end/note/break fields) — mapRawEntry() below tries several plausible
 *     names defensively and ALWAYS preserves the full raw object regardless
 *     of whether any of them match, so nothing is lost either way.
 *   - Whether an in-progress (still clocked-in) entry has a literal null
 *     end field or is simply absent from a "completed only" filter —
 *     treated as optional here either way.
 *   - Whether breaks are a sub-array on the same entry or represented as
 *     separate sibling entries per day — this client assumes the former
 *     (a `breakMinutes`/`breaks[].durationMinutes`-shaped field on the
 *     entry itself) and sums whatever it finds; if your tenant does the
 *     latter, sum per (person, calendar day) before calling
 *     import_jibble_time_entry() instead of per raw entry.
 */

const TOKEN_URL = process.env.JIBBLE_TOKEN_URL ?? "https://identity.prod.jibble.io/connect/token";
const TIME_ENTRIES_URL = process.env.JIBBLE_TIME_ENTRIES_URL ?? "https://time-tracking.prod.jibble.io/v1/TimeEntries";

export interface JibbleTimeEntry {
  /** Jibble's own stable id for this entry — the idempotency key. */
  id: string;
  personId: string;
  start: string | null;
  end: string | null;
  note: string | null;
  breakMinutes: number;
  raw: Record<string, unknown>;
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

/** First matching key's value from `obj`, trying each candidate in order — the
 * defensive lookup mapRawEntry() uses for every field whose exact name
 * isn't independently confirmed (see this file's own header). */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function sumBreakMinutes(raw: Record<string, unknown>): number {
  const direct = pick(raw, ["breakMinutes", "BreakMinutes", "breakDurationMinutes"]);
  if (typeof direct === "number") return direct;

  const breaks = pick(raw, ["breaks", "Breaks"]);
  if (Array.isArray(breaks)) {
    return breaks.reduce((total: number, b) => {
      if (b && typeof b === "object") {
        const minutes = pick(b as Record<string, unknown>, ["durationMinutes", "DurationMinutes", "minutes"]);
        if (typeof minutes === "number") return total + minutes;
        const start = pick(b as Record<string, unknown>, ["start", "Start", "startTime"]);
        const end = pick(b as Record<string, unknown>, ["end", "End", "endTime"]);
        if (typeof start === "string" && typeof end === "string") {
          const ms = Date.parse(end) - Date.parse(start);
          if (Number.isFinite(ms) && ms > 0) return total + ms / 60000;
        }
      }
      return total;
    }, 0);
  }
  return 0;
}

export function mapRawEntry(raw: Record<string, unknown>): JibbleTimeEntry | null {
  const id = pick(raw, ["id", "Id", "ID"]);
  const personId = pick(raw, ["personId", "PersonId", "memberId", "MemberId"]);
  if (typeof id !== "string" || typeof personId !== "string") return null;

  const start = pick(raw, ["start", "Start", "in", "In", "clockIn", "startTime"]);
  const end = pick(raw, ["end", "End", "out", "Out", "clockOut", "endTime"]);
  const note = pick(raw, ["note", "Note", "notes", "comment"]);

  return {
    id,
    personId,
    start: typeof start === "string" ? start : null,
    end: typeof end === "string" ? end : null,
    note: typeof note === "string" ? note : null,
    breakMinutes: sumBreakMinutes(raw),
    raw,
  };
}

/**
 * Fetches every TimeEntries record whose start falls within
 * [sinceIso, untilIso) for one Jibble organization, one page at a time
 * (standard OData `$top`/`@odata.nextLink`-style paging — see this file's
 * own header on what's confirmed vs. assumed about the exact shape). Never
 * throws on a single malformed row — mapRawEntry() returning null for it is
 * surfaced to the caller as a skipped entry, not a failed sync.
 */
export async function fetchJibbleTimeEntries(sinceIso: string, untilIso: string): Promise<{ mapped: JibbleTimeEntry[]; skipped: number }> {
  const token = await getAccessToken();
  const mapped: JibbleTimeEntry[] = [];
  let skipped = 0;
  let url: string | null =
    `${TIME_ENTRIES_URL}?$filter=start ge ${encodeURIComponent(sinceIso)} and start lt ${encodeURIComponent(untilIso)}&$top=200`;

  while (url) {
    const response: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Jibble TimeEntries request failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { value?: Record<string, unknown>[]; "@odata.nextLink"?: string };
    for (const raw of body.value ?? []) {
      const entry = mapRawEntry(raw);
      if (entry) mapped.push(entry);
      else skipped += 1;
    }
    url = body["@odata.nextLink"] ?? null;
  }

  return { mapped, skipped };
}
