/** Turns a database error into a plain sentence for the person using the form. */
export function friendlyCrmError(message: string): string {
  if (/permission denied|row-level security/i.test(message)) return "You are not allowed to do that.";
  if (/violates check constraint|violates foreign key|invalid input syntax/i.test(message)) return "One of the values is not allowed. Check the form and try again.";
  if (/duplicate key/i.test(message)) return "That already exists.";
  return message;
}

