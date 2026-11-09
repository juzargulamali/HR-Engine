import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * The confirmation PROOF. Issued by `propose` on the server (never by the model, never by the browser) and verified twice: by `execute` in the app (defence in depth) and,
 * decisive, INSIDE THE DATABASE by every JARVIS write wrapper (jarvis_verify_proof), which holds the same secret (jarvis_proof_key = JARVIS_CONFIRMATION_SECRET) and which the
 * signed-in person cannot read. A confirmation id and hash made up by a caller are therefore not proof: without this MAC nothing is written.
 *
 * The MAC is HMAC-SHA256 over this exact text, the fields joined by a line feed (format version 1):
 *   JARVIS-PROOF-V1 / proof id (confirmation id) / approving person / company / action id / target ("new" or a record id) / record version or "-" / expiry (epoch seconds) /
 *   SHA-256 (hex) of the exact payload TEXT.
 * The payload text is what the wrapper receives as p_payload, byte for byte. The token (a readable body plus the MAC) carries no brief text.
 * The same text is built in SQL (jarvis_verify_proof); supabase/tests/jarvis-proof-vectors.json holds vectors both sides must reproduce.
 */
export const PROOF_FORMAT = "JARVIS-PROOF-V1";

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

/** The exact text that is MACed. */
export function proofString(f: ProofFields): string {
  return [PROOF_FORMAT, f.cid.toLowerCase(), f.uid.toLowerCase(), f.co.toLowerCase(), f.act, f.tgt.toLowerCase(), f.ver === null ? "-" : String(f.ver), String(f.exp), f.ph].join("\n");
}

export const proofMac = (f: ProofFields, secret: string): string => createHmac("sha256", secret).update(proofString(f), "utf8").digest("hex");

const b64 = (b: Buffer) => b.toString("base64url");

/** The token the browser holds: the readable fields and the MAC. */
export function issueProof(f: ProofFields, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify({ v: 2, cid: f.cid, uid: f.uid, co: f.co, act: f.act, tgt: f.tgt, ver: f.ver, exp: f.exp, ph: f.ph }), "utf8"));
  return `${body}.${proofMac(f, secret)}`;
}

export type VerifyResult = { ok: true; fields: ProofFields; mac: string } | { ok: false; reason: "malformed" | "signature" | "expired" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function verifyProof(token: string, secret: string, now: Date): VerifyResult {
  if (typeof token !== "string" || token.length > 2000) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || !HEX64.test(parts[1])) return { ok: false, reason: "malformed" };
  let body: Record<string, unknown>;
  try { body = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Record<string, unknown>; } catch { return { ok: false, reason: "malformed" }; }
  if (!body || body.v !== 2 || typeof body.cid !== "string" || typeof body.uid !== "string" || typeof body.co !== "string" || typeof body.act !== "string"
      || typeof body.tgt !== "string" || typeof body.ph !== "string" || typeof body.exp !== "number" || !Number.isInteger(body.exp)
      || !(body.ver === null || (typeof body.ver === "number" && Number.isInteger(body.ver)))
      || !UUID.test(body.cid) || !UUID.test(body.uid) || !UUID.test(body.co) || !HEX64.test(body.ph) || !(body.tgt === "new" || UUID.test(body.tgt))) return { ok: false, reason: "malformed" };
  const fields: ProofFields = { cid: body.cid, uid: body.uid, co: body.co, act: body.act, tgt: body.tgt, ver: body.ver as number | null, exp: body.exp, ph: body.ph };
  const expected = Buffer.from(proofMac(fields, secret), "hex");
  const given = Buffer.from(parts[1], "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "signature" };
  if (Math.floor(now.getTime() / 1000) >= fields.exp) return { ok: false, reason: "expired" };
  return { ok: true, fields, mac: parts[1] };
}

/** The wrapper arguments (named as the SQL parameters) for a verified proof and the payload text whose hash it carries. */
export function proofRpcArgs(call: ProofCall) {
  return { p_confirmation: call.confirmationId, p_company: call.company, p_target: call.target, p_version: call.version, p_expires: call.expires, p_mac: call.mac, p_payload: call.payload };
}
