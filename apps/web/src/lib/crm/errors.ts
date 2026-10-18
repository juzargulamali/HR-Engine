/** Turns a database error into a plain sentence for the person using the form. */
export const SAVE_DID_NOT_FINISH = "The save did not finish in time. Reload the page to see whether it went through, then try again if it did not.";

export function friendlyCrmError(message: string): string {
  if (/TimeoutError|AbortError|aborted due to timeout|signal timed out/i.test(message)) return SAVE_DID_NOT_FINISH;
  if (/permission denied|row-level security/i.test(message)) return "You are not allowed to do that.";
  if (/violates check constraint|violates foreign key|invalid input syntax/i.test(message)) return "One of the values is not allowed. Check the form and try again.";
  if (/duplicate key/i.test(message)) return "That already exists.";
  return message;
}

