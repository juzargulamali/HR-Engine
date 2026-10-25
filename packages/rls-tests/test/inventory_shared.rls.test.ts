import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RlsTestDatabase } from "../src/harness";

// The shared Inventory helpers every stock and planning function relies on: exact daylight-saving behaviour of the local-time
// conversion (Poznan, Dubai), quantity precision, and the single definition of "free". Uses the real migrations.
describe("Inventory shared helpers", () => {
  const db = new RlsTestDatabase();
  const one = async (sql: string) => ((await db.seed(sql)).rows[0] as Record<string, unknown>);
  beforeAll(async () => { await db.setup(); }, 120_000);
  afterAll(async () => { await db.teardown(); });

  const utc = async (local: string, tz: string) => String((await one(`select to_char(inv_local_to_utc('${local}'::timestamp, '${tz}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') as v`)).v);

  it("converts ordinary Poznan and Dubai times (winter +1, summer +2, Dubai +4 all year)", async () => {
    expect(await utc("2030-01-10 09:00", "Europe/Warsaw")).toBe("2030-01-10T08:00Z");
    expect(await utc("2030-07-01 09:00", "Europe/Warsaw")).toBe("2030-07-01T07:00Z");
    expect(await utc("2030-01-10 09:00", "Asia/Dubai")).toBe("2030-01-10T05:00Z");
    expect(await utc("2030-07-01 09:00", "Asia/Dubai")).toBe("2030-07-01T05:00Z");
  });
  it("moves a time that does not exist (clocks forward, 31 March 2030 02:30 in Poznan) to the first real instant after the gap", async () => {
    expect(await utc("2030-03-31 02:30", "Europe/Warsaw")).toBe("2030-03-31T01:00Z");
    expect(await utc("2030-03-31 01:59", "Europe/Warsaw")).toBe("2030-03-31T00:59Z");
    expect(await utc("2030-03-31 03:00", "Europe/Warsaw")).toBe("2030-03-31T01:00Z");
  });
  it("takes the FIRST occurrence of a time that happens twice (clocks back, 27 October 2030 02:30 in Poznan)", async () => {
    expect(await utc("2030-10-27 02:30", "Europe/Warsaw")).toBe("2030-10-27T00:30Z");
    expect(await utc("2030-10-27 01:59", "Europe/Warsaw")).toBe("2030-10-26T23:59Z");
    expect(await utc("2030-10-27 03:30", "Europe/Warsaw")).toBe("2030-10-27T02:30Z");
  });
  it("keeps a whole day in Poznan on the day of a clock change 23 or 25 hours long", async () => {
    const hours = async (day: string) => Number((await one(`select extract(epoch from (inv_local_to_utc('${day} 00:00'::timestamp + interval '1 day', 'Europe/Warsaw') - inv_local_to_utc('${day} 00:00'::timestamp, 'Europe/Warsaw'))) / 3600 as h`)).h);
    expect(await hours("2030-03-31")).toBe(23);
    expect(await hours("2030-10-27")).toBe(25);
    expect(await hours("2030-06-10")).toBe(24);
  });
});
