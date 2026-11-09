import "server-only";
import type { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JarvisConfig } from "./config";
import type { JarvisProvider } from "./provider/types";

export type JarvisModuleId = "sales" | "projects" | "inventory" | "people_hr";
export type JarvisRisk = "read" | "draft" | "write" | "external";

/** What the person must hold, BEFORE the action's own rule applies: the module grant for the selected company (and optionally one capability of it). */
export interface JarvisRequires { moduleGrant: JarvisModuleId; capability?: string }

/** Everything an action may touch. `supabase` is the signed-in person's OWN session client (RLS applies); there is no privileged client here, by design. */
export interface JarvisContext {
  userId: string;
  companyId: string;
  supabase: SupabaseClient;
  config: JarvisConfig;
  /** Present only for actions that declare `usesProvider`. */
  provider: JarvisProvider | null;
  now: Date;
  /** Counts one provider request against the person's daily limit; false = the limit is reached. */
  takeUsage: () => Promise<{ allowed: boolean } | { error: true }>;
}

export type JarvisTarget = { kind: "new" } | { kind: "record"; id: string; version: number | null };

export interface JarvisProposal<TValues, TCard> {
  /** The exact values the person is asked to review. A confirmation is bound to the hash of these. */
  values: TValues;
  target: JarvisTarget;
  /** True only when `values` are complete and valid: a confirmation is issued only then. */
  valid: boolean;
  /** JSON-safe review card for the interface. */
  card: TCard;
}

export interface JarvisExecuteInput<TValues> {
  confirmationId: string;
  valuesHash: string;
  values: TValues;
  target: JarvisTarget;
  /** Extra, non-hashed acknowledgements the person gave on the card (e.g. "not the same enquiry"). */
  acknowledgements: Record<string, unknown>;
}

export type JarvisExecuteOutcome<TResult> =
  | { kind: "done"; result: TResult; replayed: boolean }
  | { kind: "refused"; code: "not_permitted" | "needs_review" | "invalid_input" | "save_failed"; message: string }
  | { kind: "ambiguous" };

/**
 * One typed, registered action. Deny by default: only actions registered here and enabled are reachable, and nothing else exists for the model or the browser to
 * call. An action may touch ONLY its own module's data, through that module's existing code paths and the person's own session (no cross-module reads).
 */
export interface JarvisActionDefinition<TInput = unknown, TValues = unknown, TCard = unknown, TResult = unknown> {
  id: string;
  module: JarvisModuleId;
  title: string;
  description: string;
  risk: JarvisRisk;
  requires: JarvisRequires;
  /** Registered-but-disabled actions are listed as "Not available yet" and refuse every call. */
  status: { enabled: boolean; reason?: string };
  usesProvider: boolean;
  inputSchema: z.ZodType<TInput>;
  /** Parses and normalises the values the card sends back at confirmation (unknown keys dropped, strings length-limited). */
  valuesSchema: z.ZodType<TValues>;
  /** One short sentence for the review card header. */
  describe(values: TValues): string;
  /** Builds the review card. NEVER writes. */
  propose(ctx: JarvisContext, input: TInput): Promise<JarvisProposal<TValues, TCard>>;
  /** The action's own existing permission/state rule, rechecked at execution (e.g. a record that changed, an organisation that is no longer visible). */
  authorize?(ctx: JarvisContext, values: TValues, target: JarvisTarget, meta: { confirmationId: string }): Promise<{ ok: true } | { ok: false; code?: "not_permitted" | "needs_review" | "invalid_input"; message: string }>;
  /** Writes through the module's own existing path. Only the dispatcher calls it, only after the token, hash, company and authorisation checks. */
  execute?(ctx: JarvisContext, input: JarvisExecuteInput<TValues>): Promise<JarvisExecuteOutcome<TResult>>;
  /** Reads the result back through the person's own session (the interface shows the real reference only after this succeeds). */
  verify?(ctx: JarvisContext, result: TResult): Promise<{ ok: boolean }>;
  /** How a saved result is shown (the reference and where to open it), also when it is read back from the ledger by confirmation id. Generic actions only. */
  resultView?(r: { resultId: string; reference: string; extra: Record<string, unknown> | null; target: string }): { reference: string; href: string | null; summary: string };
}

/** What a generic write action's `execute` returns as its `result` (ids and the real reference only; never text the person typed). */
export interface GenericResult { resultId: string; reference: string; extra: Record<string, unknown> | null }

export type AnyJarvisAction = JarvisActionDefinition<any, any, any, any>;

/** Thrown by an action to refuse with a code and a plain message; the dispatcher turns it into a refusal result. */
export class JarvisRefusalError extends Error {
  constructor(readonly code: import("./protocol").JarvisRefusalCode, message: string) {
    super(message);
    this.name = "JarvisRefusalError";
  }
}
