import "server-only";

/**
 * Structured server-side error logging — every call site names the route
 * and the specific operation that failed, so a Vercel function log tells
 * you exactly where to look without needing the full stack trace. Logs the
 * error's message only, never its arguments/variables, request body,
 * cookies, or any HR record content — so a query failure can never leak
 * the data it was trying to fetch. Never call this with anything derived
 * from a token, password, or env var.
 */
export function logServerError(context: { route: string; operation: string; digest?: string }, error: unknown): void {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  console.error(
    JSON.stringify({
      level: "error",
      route: context.route,
      operation: context.operation,
      digest: context.digest,
      message,
      timestamp: new Date().toISOString(),
    }),
  );
}
