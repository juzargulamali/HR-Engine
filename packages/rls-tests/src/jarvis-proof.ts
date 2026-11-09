import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * Test-side signers for the two JARVIS artefacts (the server's job in production). They build the MACs exactly as documented in
 * supabase/migrations/20261223000100_jarvis_platform.sql (jarvis_verify_proof) and apps/web/src/lib/jarvis/token.ts, with plain Node crypto, and are checked against the shared
 * vectors in supabase/tests/jarvis-proof-vectors.json. Fictional secret only.
 *
 *   * the DATABASE PROOF: HMAC(proof_key, "JARVIS-PROOF-V1" text), proof_key = HMAC(secret, "JARVIS-PROOF-KEY-V1")  (what the database verifies; it stores only proof_key)
 *   * the REVIEW TOKEN's MAC: HMAC(review_key, "JARVIS-REVIEW-V1" text), review_key = HMAC(secret, "JARVIS-REVIEW-KEY-V1")  (what the browser holds; no wrapper accepts it)
 */
export const PROOF_KEY = "rls-test-proof-key-0123456789-abcdefghij";
/** The two keys derived from a secret, the same derivations as the app and as jarvis_set_proof_key. */
export const deriveProofKey = (secret: string): Buffer => createHmac("sha256", secret).update("JARVIS-PROOF-KEY-V1", "utf8").digest();
export const deriveReviewKey = (secret: string): Buffer => createHmac("sha256", secret).update("JARVIS-REVIEW-KEY-V1", "utf8").digest();

export interface ProofInput {
  user: string;
  company: string;
  action: string;
  /** "new" or a record id. */
  target: string;
  version?: number | null;
  /** An object (sent as its JSON text) or the exact text to sign and send. */
  payload: unknown;
  /** The proof id (the confirmation id). A fresh uuid by default. */
  jti?: string;
  /** Expiry, epoch seconds. Default: one hour from now. */
  expires?: number;
  /** The SECRET the proof key is derived from (default: the test secret the database is given). */
  key?: string;
}

export interface ProofCall { jti: string; company: string; target: string; version: number | null; expires: number; mac: string; payload: string }

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

type Fields = { jti: string; user: string; company: string; action: string; target: string; version: number | null; expires: number; payload: string };
export function proofText(i: Fields, format = "JARVIS-PROOF-V1"): string {
  return [format, i.jti, i.user, i.company, i.action, i.target, i.version === null ? "-" : String(i.version), String(i.expires), sha256Hex(i.payload)].join("\n");
}

export function proofCall(i: ProofInput): ProofCall {
  const payload = typeof i.payload === "string" ? i.payload : JSON.stringify(i.payload);
  const jti = i.jti ?? randomUUID();
  const expires = i.expires ?? Math.floor(Date.now() / 1000) + 3600;
  const version = i.version ?? null;
  const mac = createHmac("sha256", deriveProofKey(i.key ?? PROOF_KEY)).update(proofText({ jti, user: i.user, company: i.company, action: i.action, target: i.target, version, expires, payload }), "utf8").digest("hex");
  return { jti, company: i.company, target: i.target, version, expires, mac, payload };
}

/** What the app issues at PROPOSAL time and the browser holds: the review token for the same fields (review key, review domain). Its MAC is NOT a database proof. */
export function reviewCall(i: ProofInput): ProofCall & { token: string } {
  const payload = typeof i.payload === "string" ? i.payload : JSON.stringify(i.payload);
  const jti = i.jti ?? randomUUID();
  const expires = i.expires ?? Math.floor(Date.now() / 1000) + 900;
  const version = i.version ?? null;
  const f = { jti, user: i.user, company: i.company, action: i.action, target: i.target, version, expires, payload };
  const mac = createHmac("sha256", deriveReviewKey(i.key ?? PROOF_KEY)).update(proofText(f, "JARVIS-REVIEW-V1"), "utf8").digest("hex");
  const body = Buffer.from(JSON.stringify({ v: 3, cid: jti, uid: i.user, co: i.company, act: i.action, tgt: i.target, ver: version, exp: expires, ph: sha256Hex(payload) }), "utf8").toString("base64url");
  return { jti, company: i.company, target: i.target, version, expires, mac, payload, token: `${body}.${mac}` };
}

/** The positional arguments of every write wrapper (confirmation, company, target, version, expires, mac, payload). */
export const callArgs = (c: ProofCall): unknown[] => [c.jti, c.company, c.target, c.version, c.expires, c.mac, c.payload];
/** `select <fn>($1::uuid, $2::uuid, $3, $4::integer, $5::bigint, $6, $7) as r`: every wrapper takes exactly these seven arguments, all of them signed (the person is auth.uid()). */
export const wrapperSql = (fn: string) => `select ${fn}($1::uuid, $2::uuid, $3, $4::integer, $5::bigint, $6, $7) as r`;
