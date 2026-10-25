/** True when an error means "we do not know whether it was saved" (so the page offers the result check, not a blind retry). Safe for the browser. */
export function isUncertain(message: string | null | undefined): boolean {
  return !!message && /did not finish in time/i.test(message);
}
