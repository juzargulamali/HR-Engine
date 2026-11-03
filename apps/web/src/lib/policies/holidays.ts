export interface HolidayRow { id: string; country_code: string; countryName: string; holiday_date: string; name: string }

/** The person's own country split into what is coming (today included) and what has passed, plus every other country by date. Dates are plain YYYY-MM-DD strings. */
export function splitHolidays(rows: readonly HolidayRow[], ownCountry: string | null, today: string): { upcoming: HolidayRow[]; earlier: HolidayRow[]; others: HolidayRow[] } {
  const byDate = (a: HolidayRow, b: HolidayRow) => a.holiday_date.localeCompare(b.holiday_date) || a.name.localeCompare(b.name);
  const mine = ownCountry === null ? [] : rows.filter((r) => r.country_code === ownCountry);
  return {
    upcoming: mine.filter((r) => r.holiday_date >= today).sort(byDate),
    earlier: mine.filter((r) => r.holiday_date < today).sort((a, b) => byDate(b, a)),
    others: rows.filter((r) => ownCountry === null || r.country_code !== ownCountry).sort(byDate),
  };
}
