import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The confirmation token. Issued by `propose` (never by the model, never by the browser), checked by `execute`. It binds ONE person, ONE company, ONE action, ONE
 * target, the hash of the exact reviewed values and (for an existing record) its version, plus an expiry. It is signed with a server secret
 * (JARVIS_CONFIRMATION_SECRET), so it cannot be forged, altered or moved to another person or company; it is not secret (the payload is readable) and carries no brief text.
 */
export interface ConfirmationPayload {
  v: 1;
  /** The confirmation id: the idempotency key in the ledger. */
  cid: string;
  /** user id */
  uid: string;
  /** company id */
  co: string;
  /** action id */
  act: string;
  /** "new" or a record id */
  tgt: string;
  /** version of the target record, when there is one */
  ver: number | null;
  /** hash of the exact reviewed values */
  h: string;
  /** issued at / expires at, epoch seconds */
  iat: number;
  exp: number;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function signConfirmation(payload: ConfirmationPayload, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = b64(createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

export type VerifyResult = { ok: true; payload: ConfirmationPayload } | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyConfirmation(token: string, secret: string, now: Date): VerifyResult {
  if (typeof token !== "string" || token.length > 2000) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "malformed" };
  const expected = createHmac("sha256", secret).update(parts[0]).digest();
  let given: Buffer;
  try { given = Buffer.from(parts[1], "base64url"); } catch { return { ok: false, reason: "malformed" }; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  let payload: ConfirmationPayload;
  try { payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as ConfirmationPayload; } catch { return { ok: false, reason: "malformed" }; }
  if (payload?.v !== 1 || typeof payload.cid !== "string" || typeof payload.uid !== "string" || typeof payload.co !== "string" || typeof payload.act !== "string"
      || typeof payload.tgt !== "string" || typeof payload.h !== "string" || typeof payload.exp !== "number") return { ok: false, reason: "malformed" };
  if (Math.floor(now.getTime() / 1000) >= payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}
