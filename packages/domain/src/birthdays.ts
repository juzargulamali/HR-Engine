/**
 * Days from `today` until the next occurrence of the month/day encoded in
 * `dateOfBirth` — 0 if today IS that day. The year in `dateOfBirth` only
 * matters for age, never here: a birthday recurs every year, so this always
 * looks for this year's occurrence first and rolls to next year's if it's
 * already passed. A Feb 29 birthday is clamped to Feb 28 in a non-leap
 * year, the same "clamp to the real last day of the month" idea
 * addMonthsClamped uses for a similar reason.
 */
export function daysUntilNextBirthday(dateOfBirth: string, today: string): number {
  const dobParts = dateOfBirth.split("-").map(Number);
  const dobMonth = dobParts[1] ?? 1;
  const dobDay = dobParts[2] ?? 1;
  const todayParts = today.split("-").map(Number);
  const todayYear = todayParts[0] ?? 0;
  const todayMonth = todayParts[1] ?? 1;
  const todayDay = todayParts[2] ?? 1;

  function occursOn(year: number): number {
    const daysInMonth = new Date(Date.UTC(year, dobMonth, 0)).getUTCDate();
    return Date.UTC(year, dobMonth - 1, Math.min(dobDay, daysInMonth));
  }

  const todayMs = Date.UTC(todayYear, todayMonth - 1, todayDay);
  const candidateMs = occursOn(todayYear) < todayMs ? occursOn(todayYear + 1) : occursOn(todayYear);
  return Math.round((candidateMs - todayMs) / (24 * 60 * 60 * 1000));
}

/** True when today is the employee's birthday (recurring every year). */
export function isBirthdayToday(dateOfBirth: string, today: string): boolean {
  return daysUntilNextBirthday(dateOfBirth, today) === 0;
}
