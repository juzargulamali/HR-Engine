/**
 * The provider seam. A provider receives ONLY what the task needs (the pasted text and the field schema for that task) and returns a plain JSON object, which the
 * caller then validates and prunes; the model never receives tools for other modules, other records, the app map, or any record the person cannot see, and it has
 * no way to act: the only thing it can do is return a proposal object.
 */
export interface StructuredRequest {
  /** What is being asked, e.g. "enquiry_fields". */
  task: string;
  /** The fixed instruction text of the task (never built from user text). */
  instructions: string;
  /** The untrusted text to read (the pasted brief) and nothing else. */
  input: string;
  /** JSON schema of the single object the model must return. */
  jsonSchema: Record<string, unknown>;
  maxOutputTokens: number;
  timeoutMs: number;
}

export class JarvisProviderError extends Error {
  constructor(readonly kind: "timeout" | "http" | "malformed" | "network", readonly status?: number) {
    super(`provider ${kind}${status ? ` ${status}` : ""}`);
    this.name = "JarvisProviderError";
  }
}

export interface JarvisProvider {
  readonly kind: "anthropic" | "simulated";
  structured(req: StructuredRequest): Promise<unknown>;
}
