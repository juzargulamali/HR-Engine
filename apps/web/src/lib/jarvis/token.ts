import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * TWO DISTINCT ARTEFACTS, derived from the one secret the owner sets (JARVIS_CONFIRMATION_SECRET; the same value is given to the database with jarvis_set_proof_key):
 *
 *   REVIEW TOKEN   issued at PROPOSAL time and held by the browser. Keyed with review_key = HMAC-SHA256(secret, "JARVIS-REVIEW-KEY-V1"), domain "JARVIS-REVIEW-V1". Verified ONLY
 *                  by the app server, at the explicit confirmation request. The database never holds review_key (it stores only proof_key) and no wrapper accepts it: a review
 *                  token is cryptographically unusable as a database proof (another key AND another domain prefix).
 *   DATABASE PROOF issued SERVER-SIDE ONLY, inside the confirmation request, after the review token, the access and the values have been re-verified. Keyed with
 *                  proof_key = HMAC-SHA256(secret, "JARVIS-PROOF-KEY-V1"), domain "JARVIS-PROOF-V1". Verified INSIDE the database by every write wrapper
 *                  (jarvis_verify_proof). It is passed to the wrapper in the same request and is NEVER returned to the browser, logged, stored or put in a URL or a response.
 *                  It lives for a short time (JARVIS_PROOF_TTL_SECONDS, default 120) and carries the SAME confirmation id (jti) as the review token, so a retry gets a fresh proof
 *                  for the same confirmation and the ledger returns the ORIGINAL result.
 *
 * Both are HMAC-SHA256 over a text of fields joined by a line feed (format version 1 of each):
 *   JARVIS-REVIEW-V1 / jti / person / company / action / target ("new" or a record id) / record version or "-" / review expiry (epoch s) / SHA-256 (hex) of the reviewed payload TEXT
 *   JARVIS-PROOF-V1  / jti / person / company / action / target / record version or "-" / proof expiry (epoch s) / SHA-256 (hex) of the exact payload TEXT sent to the wrapper
 * The payload text is what the wrapper receives as p_payload, byte for byte. Neither carries brief text. The proof side is rebuilt in SQL (jarvis_verify_proof);
 * supabase/tests/jarvis-proof-vectors.json holds vectors (both derivations, both artefacts) that every side must reproduce.
 */
export const PROOF_FORMAT = "JARVIS-PROOF-V1";
export const REVIEW_FORMAT = "JARVIS-REVIEW-V1";
export const PROOF_KEY_LABEL = "JARVIS-PROOF-KEY-V1";
export const REVIEW_KEY_LABEL = "JARVIS-REVIEW-KEY-V1";

/** The key only the database (proof side) knows: HMAC(secret, label). The same derivation runs in SQL (jarvis_set_proof_key). */
export const deriveProofKey = (secret: string): Buffer => createHmac("sha256", secret).update(PROOF_KEY_LABEL, "utf8").digest();
/** The key only the app server knows (review side). The database never computes or stores it. */
export const deriveReviewKey = (secret: string): Buffer => createHmac("sha256", secret).update(REVIEW_KEY_LABEL, "utf8").digest();

export interface ProofFields {
  /** The proof id: the confirmation id (also the idempotency key in the ledger). A lower-case uuid. */
  cid: string;
  /** The approving person (user id). */
  uid: string;
  /** Company id. */
  co: string;
  /** Action id (each wrapper hard-codes its own). */
  act: string;
  /** "new" or the target record id. */
  tgt: string;
  /** Version of the target record, when the action is bound to one. */
  ver: number | null;
  /** Expiry, epoch seconds. */
  exp: number;
  /** SHA-256 (hex) of the exact payload text. */
  ph: string;
}
/** What goes to the database: exactly the signed fields and the payload text (the wrapper's arguments, besides the person, who is auth.uid()). */
export interface ProofCall {
  confirmationId: string;
  company: string;
  target: string;
  version: number | null;
  expires: number;
  mac: string;
  payload: string;
}

export const payloadHash = (payload: string): string => createHash("sha256").update(payload, "utf8").digest("hex");

const fieldsText = (format: string, f: ProofFields) =>
  [format, f.cid.toLowerCase(), f.uid.toLowerCase(), f.co.toLowerCase(), f.act, f.tgt.toLowerCase(), f.ver === null ? "-" : String(f.ver), String(f.exp), f.ph].join("\n");

/** The exact text the DATABASE PROOF MACs (rebuilt in SQL by jarvis_verify_proof). */
export const proofString = (f: ProofFields): string => fieldsText(PROOF_FORMAT, f);
/** The exact text the REVIEW TOKEN MACs. Another domain prefix than the proof's, so the two can never be the same text. */
export const reviewString = (f: ProofFields): string => fieldsText(REVIEW_FORMAT, f);

/** MAC of the database proof (hex), with the PROOF key derived from the secret. */
export const proofMac = (f: ProofFields, secret: string): string => createHmac("sha256", deriveProofKey(secret)).update(proofString(f), "utf8").digest("hex");
/** MAC of the review token (hex), with the REVIEW key derived from the secret. */
export const reviewMac = (f: ProofFields, secret: string): string => createHmac("sha256", deriveReviewKey(secret)).update(reviewString(f), "utf8").digest("hex");

const b64 = (b: Buffer) => b.toString("base64url");

/** The REVIEW TOKEN the browser holds: the readable fields, the reviewed values' hash and a MAC only this server can check. It is not, and cannot be turned into, a database proof. */
export function issueReview(f: ProofFields, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify({ v: 3, cid: f.cid, uid: f.uid, co: f.co, act: f.act, tgt: f.tgt, ver: f.ver, exp: f.exp, ph: f.ph }), "utf8"));
  return `${body}.${reviewMac(f, secret)}`;
}

export type VerifyResult = { ok: true; fields: ProofFields } | { ok: false; reason: "malformed" | "signature" | "expired" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** Verifies a review token (signature with the review key, shape, expiry). Binding to the person, company, action, target and values is checked by the caller. */
export function verifyReview(token: string, secret: string, now: Date): VerifyResult {
  if (typeof token !== "string" || token.length > 2000) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !HEX64.test(parts[1])) return { ok: false, reason: "malformed" };
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>; } catch { return { ok: false, reason: "malformed" }; }
  if (!body || body.v !== 3 || typeof body.cid !== "string" || typeof body.uid !== "string" || typeof body.co !== "string" || typeof body.act !== "string"
      || typeof body.tgt !== "string" || typeof body.ph !== "string" || typeof body.exp !== "number" || !Number.isInteger(body.exp)
      || !(body.ver === null || (typeof body.ver === "number" && Number.isInteger(body.ver)))
      || !UUID.test(body.cid) || !UUID.test(body.uid) || !UUID.test(body.co) || !HEX64.test(body.ph) || !(body.tgt === "new" || UUID.test(body.tgt))) return { ok: false, reason: "malformed" };
  const fields: ProofFields = { cid: body.cid, uid: body.uid, co: body.co, act: body.act, tgt: body.tgt, ver: body.ver as number | null, exp: body.exp, ph: body.ph };
  const expected = Buffer.from(reviewMac(fields, secret), "hex");
  const given = Buffer.from(parts[1], "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  if (Math.floor(now.getTime() / 1000) >= fields.exp) return { ok: false, reason: "expired" };
  return { ok: true, fields };
}

/**
 * The DATABASE PROOF for one confirmation request: the same confirmation id (jti) as the review token, a fresh short expiry, and the SHA-256 of the exact payload text that is sent
 * with it. Server-side only: the result goes straight into the wrapper call (proofRpcArgs) and nowhere else.
 */
export function issueDbProof(i: { cid: string; uid: string; co: string; act: string; tgt: string; ver: number | null; exp: number; payload: string }, secret: string): ProofCall {
  const f: ProofFields = { cid: i.cid, uid: i.uid, co: i.co, act: i.act, tgt: i.tgt, ver: i.ver, exp: i.exp, ph: payloadHash(i.payload) };
  return { confirmationId: i.cid.toLowerCase(), company: i.co.toLowerCase(), target: i.tgt.toLowerCase(), version: i.ver, expires: i.exp, mac: proofMac(f, secret), payload: i.payload };
}

/** The wrapper arguments (named as the SQL parameters) for a database proof and the payload text whose hash it carries. */
export function proofRpcArgs(call: ProofCall) {
  return { p_confirmation: call.confirmationId, p_company: call.company, p_target: call.target, p_version: call.version, p_expires: call.expires, p_mac: call.mac, p_payload: call.payload };
}
