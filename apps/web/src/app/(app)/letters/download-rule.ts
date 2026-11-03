/**
 * Who may be offered the download of a letter's file. An employee only once the letter is ISSUED (a letter that still needs sign-off, or was rejected or
 * voided, is not in their hands); people who manage letters (HR) keep downloading in every status so they can review before sign-off. The storage policy
 * `letters_select` enforces the same rule for the employee, so a direct link while pending is refused too.
 */
export function canDownloadLetter(status: string, canManage: boolean): boolean {
  return canManage || status === "issued";
}
