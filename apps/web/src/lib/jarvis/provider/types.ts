/**
 * The provider seam. A provider receives ONLY what the task needs (the pasted text and the field schema for that task) and returns a plain JSON object, which the
 * caller then validates and prunes; the model never receives tools for other modules, other records, the app map, or any record the person cannot see, and it has
 * no way to act: the only thing it can do is return a proposal object.
 */
export interface StructuredRequest {
  /** What the request is built from. The outbound gate (lib/jarvis/outbound.ts) refuses a request whose sources the rulebook does not approve for the capability. */
  sources: import("../rulebook").OutboundSource[];
  /** What is being asked, e.g. "enquiry_fields". */
  task: string;
  /** The fixed instruction text of the task (never built from user text). */
  instructions: string;
  /** The untrusted text the PERSON supplied for this task (the pasted brief, the message, the bounded conversation). Never text the app read from the database. */
  input: string;
  /**
   * App-held data, in the only two shapes the outbound gate accepts. Server code fills these from typed projections (lib/jarvis/sales/projection.ts); nothing the browser
   * sends can land here. The gate screens both under the "app" rule (no stored financial figure, nothing protected) and appends them to `input` itself.
   *   facts: operational fact lines. `label` is fixed wording from the code; `value` is a count, a date, a name or a screened title.
   *   recordText: free text of a record (brief, scope, notes), already reduced locally by redactAppText.
   */
  facts?: FactLine[];
  recordText?: string;
  /** The tag the provider wraps `input` in (default "brief"); null = `input` already carries its own tags. */
  inputTag?: string | null;
  /** Task-specific closing instruction for the system text (default: extract only, never guess). */
  guard?: string;
  /** JSON schema of the single object the model must return. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}

/** One operational fact for the provider: fixed label, plain value. */
export interface FactLine { label: string; value: string | number }

export type JarvisProviderFailure = "timeout" | "http" | "malformed" | "network";

/** Only the sanitised facts about a failure: never a message, a body, a header, a key, a prompt or customer text. */
export interface JarvisProviderErrorDetail {
  /** The API's `error.type` string (e.g. "invalid_request_error"), kept only when it matches /^[a-z_]{1,64}$/; otherwise null. Never the error message. */
  apiErrorType?: string | null;
  /** Milliseconds from sending the request until the failure was known. */
  elapsedMs?: number;
}

export class JarvisProviderError extends Error {
  readonly apiErrorType: string | null;
  readonly elapsedMs: number | null;
  constructor(readonly kind: JarvisProviderFailure, readonly status?: number, detail: JarvisProviderErrorDetail = {}) {
    super(`provider ${kind}${status ? ` ${status}` : ""}`);
    this.name = "JarvisProviderError";
    this.apiErrorType = typeof detail.apiErrorType === "string" && API_ERROR_TYPE.test(detail.apiErrorType) ? detail.apiErrorType : null;
    this.elapsedMs = typeof detail.elapsedMs === "number" && Number.isFinite(detail.elapsedMs) ? Math.max(0, Math.round(detail.elapsedMs)) : null;
  }
}

/** The only shape of API error type that is ever logged. */
export const API_ERROR_TYPE = /^[a-z_]{1,64}$/;

export interface JarvisProvider {
  readonly kind: "anthropic" | "simulated";
  structured(req: StructuredRequest): Promise<unknown>;
}
