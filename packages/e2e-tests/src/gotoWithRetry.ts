import type { Page } from "@playwright/test";

/**
 * This sandbox's outbound path to Production goes through a session-level
 * HTTPS proxy (see /root/.ccr/README.md) that has shown transient
 * connection-level failures under sustained use during this suite's first
 * live run (`net::ERR_TOO_MANY_RETRIES` on an otherwise-healthy login page,
 * confirmed reachable via curl/openssl moments earlier) — infrastructure
 * flakiness in this one sandboxed network hop, not an application defect.
 * Retrying a plain navigation a couple of times is the standard, narrowly
 * scoped fix for that class of failure; it does not retry on an HTTP error
 * status or any assertion failure, only on the browser-level network errors
 * below, so a real app bug still fails the test.
 */
const RETRYABLE_ERROR_PATTERN = /ERR_TOO_MANY_RETRIES|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_EMPTY_RESPONSE|ERR_CONNECTION_REFUSED|net::ERR_ABORTED/;

export async function gotoWithRetry(page: Page, url: string, options?: Parameters<Page["goto"]>[1], attempts = 3): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(url, options);
      return;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!RETRYABLE_ERROR_PATTERN.test(message) || attempt === attempts) {
        throw err;
      }
      await page.waitForTimeout(1_000 * attempt);
    }
  }
  throw lastError;
}
