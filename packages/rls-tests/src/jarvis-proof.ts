import { createHash, createHmac, randomUUID } from "node:crypto";

/**
 * Test-side signer for the JARVIS confirmation PROOF (the server's job in production). It builds the MAC exactly as documented in
 * supabase/migrations/20261223000100_jarvis_platform.sql (jarvis_verify_proof) and apps/web/src/lib/jarvis/token.ts, with plain Node crypto, and is checked against the shared
 * vectors in supabase/tests/jarvis-proof-vectors.json. Fictional key only.
 */
export const PROOF_KEY = "rls-test-proof-key-0123456789-abcdefghij";

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
  /** The key to sign with (default: the test key the database is given). */
  key?: string;
}

export interface ProofCall { jti: string; company: string; target: string; version: number | null; expires: number; mac: string; payload: string }

export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export function proofText(i: { jti: string; user: string; company: string; action: string; target: string; version: number | null; expires: number; payload: string }): string {
  return ["JARVIS-PROOF-V1", i.jti, i.user, i.company, i.action, i.target, i.version === null ? "-" : String(i.version), String(i.expires), sha256Hex(i.payload)].join("\n");
}

export function proofCall(i: ProofInput): ProofCall {
  const payload = typeof i.payload === "string" ? i.payload : JSON.stringify(i.payload);
  const jti = i.jti ?? randomUUID();
  const expires = i.expires ?? Math.floor(Date.now() / 1000) + 3600;
  const version = i.version ?? null;
  const mac = createHmac("sha256", i.key ?? PROOF_KEY).update(proofText({ jti, user: i.user, company: i.company, action: i.action, target: i.target, version, expires, payload }), "utf8").digest("hex");
  return { jti, company: i.company, target: i.target, version, expires, mac, payload };
}

/** The positional arguments of every write wrapper (confirmation, company, target, version, expires, mac, payload). */
export const callArgs = (c: ProofCall): unknown[] => [c.jti, c.company, c.target, c.version, c.expires, c.mac, c.payload];
/** `select <fn>($1::uuid, $2::uuid, $3, $4::integer, $5::bigint, $6, $7 [, extra]) as r` */
export const wrapperSql = (fn: string, extra = "") => `select ${fn}($1::uuid, $2::uuid, $3, $4::integer, $5::bigint, $6, $7${extra}) as r`;
