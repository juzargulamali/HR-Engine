/** Monday to Sunday of the week that contains `today`, as plain dates (no time zone, no local-time Date objects). */
export function weekWindow(today: string): { start: string; end: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  const iso = (offset: number) => new Date(d.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  return { start: iso(-back), end: iso(6 - back) };
}

/** `date` moved by whole days, as a plain date. */
export function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b - a), by calendar date. */
export function daysBetweenIso(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000);
}
