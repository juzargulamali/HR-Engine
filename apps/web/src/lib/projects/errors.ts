/** Turns a database error into a plain sentence for the person using the form. Most Projects functions already raise readable text. */
export function friendlyProjectError(message: string): string {
  if (/TimeoutError|AbortError|aborted due to timeout|signal timed out/i.test(message)) return "The save did not finish in time. Reload the page to see whether it went through, then try again if it did not.";
  if (/permission denied|row-level security/i.test(message)) return "You are not allowed to do that.";
  if (/violates check constraint|violates foreign key|invalid input syntax/i.test(message)) return "One of the values is not allowed. Check the form and try again.";
  if (/duplicate key/i.test(message)) return "That already exists.";
  if (/could not find the (table|function)|schema cache|does not exist/i.test(message)) return "Projects & Tasks is not installed in this environment yet.";
  return message;
}

/** True when the Projects tables or functions do not exist yet (the migrations have not been applied to this database). */
export function isNotInstalled(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "42883" || error.code === "PGRST205" || error.code === "PGRST202" || /schema cache|does not exist/i.test(error.message ?? "");
}
