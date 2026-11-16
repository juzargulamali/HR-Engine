/**
 * The ONE rule for what an employee number is, the same in the app and in the database (`employee_number_canonical`, migration 20270117000100). Two numbers are the same number
 * when their canonical forms are equal, so E02, e002 and E002 are one number and are saved as E002. There is ONE series for every Enginious company: a number belongs to one employee record
 * and is unique across all companies. New hires are numbered by the database (E001, E002, ...); this file is for checking a number that is supplied or changed by hand.
 *
 *   1. trim and remove every space, then upper-case;
 *   2. if the number ends in digits, drop those digits' leading zeros and pad back to at least three digits (E2 -> E002, E01234 -> E1234);
 *   3. a number with no trailing digits is only trimmed and upper-cased.
 *
 * Only the digits at the END are numeric: a letter or a hyphen is part of the prefix and must match (L-1 is L-001, not E001). Existing numbers are never rewritten by this rule; it decides
 * what counts as a duplicate and what a NEW or CHANGED number is saved as. `supabase/tests/employee-number-vectors.json` holds the examples both implementations are tested against.
 */
export const EMPLOYEE_NUMBER_MIN_DIGITS = 3;
export const EMPLOYEE_NUMBER_MAX_LENGTH = 40;

export function canonicalEmployeeNumber(input: string): string {
  const s = input.replace(/\s+/g, "").toUpperCase();
  const m = /^(.*?)([0-9]+)$/.exec(s);
  if (!m) return s;
  const digits = m[2]!.replace(/^0+/, "");
  return `${m[1]}${digits.padStart(EMPLOYEE_NUMBER_MIN_DIGITS, "0")}`;
}

/** Two entries name the same employee number. */
export const sameEmployeeNumber = (a: string, b: string): boolean => canonicalEmployeeNumber(a) === canonicalEmployeeNumber(b);

export type EmployeeNumberCheck = { ok: true; canonical: string } | { ok: false; message: string };

/** What the entry paths run first: empty and over-long numbers are refused with a plain sentence; anything else yields the canonical form to save. */
export function checkEmployeeNumber(input: string): EmployeeNumberCheck {
  const canonical = canonicalEmployeeNumber(input);
  if (canonical === "") return { ok: false, message: "Enter the employee number." };
  if (canonical.length > EMPLOYEE_NUMBER_MAX_LENGTH) return { ok: false, message: `Keep the employee number to ${EMPLOYEE_NUMBER_MAX_LENGTH} characters or fewer.` };
  return { ok: true, canonical };
}

/** The sentence for a number that is already held. The database raises the same words (employees_save_canonical_number), so a duplicate reads the same on every path. */
export function duplicateEmployeeNumberMessage(entered: string, canonical: string): string {
  const typed = entered.trim();
  const alias = typed && typed.replace(/\s+/g, "").toUpperCase() !== canonical ? ` ${typed} is the same number as ${canonical}.` : "";
  return `Employee number ${canonical} is already used by another employee, in this or another company.${alias} Numbers that differ only in capitals, spaces or leading zeros are the same number, and one number belongs to one employee across Enginious. Use a different number.`;
}

/** What to show for a database error on a write that carries a number (a correction, a restore): the database's own sentence for a duplicate, a plain fallback otherwise. */
export function employeeNumberErrorMessage(error: { code?: string | null; message?: string | null }): string {
  if (error.code === "23505" && /employee number/i.test(error.message ?? "")) return error.message!;
  if (error.code === "23505") return "That employee number is already used by another employee, in this or another company. Nothing was saved.";
  return error.message ?? "The employee number could not be saved.";
}
