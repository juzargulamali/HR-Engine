import { describe, expect, it } from "vitest";
import { splitHolidays, type HolidayRow } from "./holidays";

const h = (id: string, country_code: string, holiday_date: string, name = id): HolidayRow => ({ id, country_code, countryName: country_code, holiday_date, name });

describe("holidays for staff", () => {
  const rows = [h("a", "AE", "2026-12-02"), h("b", "AE", "2026-01-01"), h("c", "AE", "2026-11-03"), h("d", "PL", "2026-12-25"), h("e", "SA", "2026-09-23")];
  it("puts the own country first: what is coming (today included) by date, then what has passed, newest first", () => {
    const r = splitHolidays(rows, "AE", "2026-11-03");
    expect(r.upcoming.map((x) => x.id)).toEqual(["c", "a"]);
    expect(r.earlier.map((x) => x.id)).toEqual(["b"]);
    expect(r.others.map((x) => x.id)).toEqual(["e", "d"]);
  });
  it("lists every country when the person's country is not known, rather than hiding or guessing", () => {
    const r = splitHolidays(rows, null, "2026-11-03");
    expect(r.upcoming).toEqual([]);
    expect(r.others).toHaveLength(5);
  });
});
