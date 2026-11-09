import "server-only";

/**
 * Operational logging for JARVIS. Deliberately blind: it accepts only a fixed set of short, token-like fields (event, action id, outcome code, provider kind, a
 * duration). It never takes a brief, a prompt, model output, a provider error body, an email, a record title or any free text: a value that is not a short
 * identifier-like token is dropped, so a mistaken call cannot leak the text.
 */
export interface JarvisLogFields {
  event: "availability" | "message" | "propose" | "execute" | "status" | "provider" | "refused";
  actionId?: string;
  code?: string;
  outcome?: string;
  providerKind?: string;
  ms?: number;
  status?: number;
}

const TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;

export function sanitiseLog(fields: JarvisLogFields): Record<string, string | number> {
  const out: Record<string, string | number> = { level: "info", area: "jarvis" };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.round(v);
    else if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
  }
  return out;
}

export function jarvisLog(fields: JarvisLogFields): void {
  console.info(JSON.stringify({ ...sanitiseLog(fields), timestamp: new Date().toISOString() }));
}
