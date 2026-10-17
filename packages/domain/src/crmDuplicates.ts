/**
 * Duplicate-enquiry detection for Sales & CRM.
 *
 * An agency or end client often brings several genuinely separate briefs, so sharing an organisation is NEVER enough
 * to flag a duplicate. The database function crm_find_duplicate_candidates returns recent opportunities that share an
 * organisation or the same dates and place; this module scores each against the new enquiry using the organisation
 * as a small supporting signal and the job itself (title, dates, location, technologies) as the real evidence.
 * Results are warnings the user can dismiss; nothing here blocks saving.
 */

export interface DuplicateTech {
  name: string;
  qty: number;
}

export interface DuplicateSubject {
  agencyOrgId?: string | null;
  clientOrgId?: string | null;
  title?: string | null;
  eventStart?: string | null; // YYYY-MM-DD
  installStart?: string | null; // YYYY-MM-DD
  location?: string | null;
  technologies?: readonly DuplicateTech[] | null;
}

export interface DuplicateCandidate extends DuplicateSubject {
  id: string;
  reference: string;
  stage: string;
  createdAt?: string;
}

export interface DuplicateMatch {
  candidate: DuplicateCandidate;
  score: number;
  level: "likely" | "possible";
  reasons: string[];
}

const STOP_WORDS = new Set(["the", "a", "an", "for", "of", "and", "at", "in", "on", "to", "with", "new", "launch", "event", "project", "activation", "interactive"]);

/** Mirrors crm_organisations.name_key: lower-case letters and digits only. */
export function organisationNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function words(text: string | null | undefined): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function dayDiff(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000));
}

const normPlace = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const DUPLICATE_THRESHOLDS = { likely: 60, possible: 40 } as const;

/** Max points from each signal. The organisation signal is deliberately small: 15 of 100, and it can never reach "possible" alone. */
export const DUPLICATE_WEIGHTS = { organisations: 15, title: 35, dates: 25, location: 10, technologies: 15 } as const;

export function scoreDuplicate(subject: DuplicateSubject, candidate: DuplicateCandidate): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const sameAgency = !!subject.agencyOrgId && subject.agencyOrgId === candidate.agencyOrgId;
  const sameClient = !!subject.clientOrgId && subject.clientOrgId === candidate.clientOrgId;
  if (sameAgency && sameClient) {
    score += DUPLICATE_WEIGHTS.organisations;
    reasons.push("Same agency and same end client");
  } else if (sameAgency || sameClient) {
    score += 6;
    reasons.push(sameAgency ? "Same agency" : "Same end client");
  }

  const t = jaccard(words(subject.title), words(candidate.title));
  if (t > 0) {
    score += Math.round(t * DUPLICATE_WEIGHTS.title);
    if (t >= 0.34) reasons.push("Similar title");
  }

  let datePoints = 0;
  if (subject.eventStart && candidate.eventStart) {
    const d = dayDiff(subject.eventStart, candidate.eventStart);
    if (d <= 3) { datePoints = Math.max(datePoints, 25); reasons.push(d === 0 ? "Same event date" : "Event dates within 3 days"); }
    else if (d <= 14) { datePoints = Math.max(datePoints, 10); reasons.push("Event dates within 2 weeks"); }
  }
  if (subject.installStart && candidate.installStart) {
    const d = dayDiff(subject.installStart, candidate.installStart);
    if (d <= 3) { datePoints = Math.max(datePoints, 20); reasons.push("Installation dates within 3 days"); }
  }
  score += datePoints;

  const pa = normPlace(subject.location);
  const pb = normPlace(candidate.location);
  if (pa && pb && (pa === pb || pa.includes(pb) || pb.includes(pa))) {
    score += DUPLICATE_WEIGHTS.location;
    reasons.push("Same location");
  }

  const ta = new Set((subject.technologies ?? []).map((x) => x.name.toLowerCase().trim()));
  const tb = new Set((candidate.technologies ?? []).map((x) => x.name.toLowerCase().trim()));
  const tj = jaccard(ta, tb);
  if (tj > 0) {
    score += Math.round(tj * DUPLICATE_WEIGHTS.technologies);
    if (tj >= 0.5) reasons.push("Same technologies");
  }

  return { score: Math.min(100, score), reasons };
}

/** Candidates worth a warning, strongest first. Opportunities that share only an organisation never appear. */
export function findLikelyDuplicates(subject: DuplicateSubject, candidates: readonly DuplicateCandidate[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const candidate of candidates) {
    const { score, reasons } = scoreDuplicate(subject, candidate);
    if (score >= DUPLICATE_THRESHOLDS.possible) {
      out.push({ candidate, score, reasons, level: score >= DUPLICATE_THRESHOLDS.likely ? "likely" : "possible" });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}
