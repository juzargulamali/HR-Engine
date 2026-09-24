import { describe, expect, it, vi } from "vitest";
import { getBusinessHour } from "@enginious-hr/domain";

// page.tsx transitively imports lib/weather.ts, which is marked
// "server-only" so an accidental Client Component import fails at build
// time — vitest's Node environment isn't a Next.js build, so it throws on
// the bare import unless stubbed out here (same pattern as the
// leave-accrual cron route test and lib/weather.test.ts).
vi.mock("server-only", () => ({}));

const { greetingPeriod } = await import("./page");

describe("greetingPeriod — dashboard greeting matches the displayed local clock", () => {
  it("buckets hours into morning/afternoon/evening", () => {
    expect(greetingPeriod(0)).toBe("morning");
    expect(greetingPeriod(11)).toBe("morning");
    expect(greetingPeriod(12)).toBe("afternoon");
    expect(greetingPeriod(16)).toBe("afternoon");
    expect(greetingPeriod(17)).toBe("evening");
    expect(greetingPeriod(23)).toBe("evening");
  });

  it("an employee-only dashboard's greeting must use THAT employee's own business hour, not Dubai's — the two can disagree for the same instant", () => {
    // 24 Sep 2026 20:30 UTC = 00:30 in Dubai (UTC+4, "morning") but 22:30 in
    // Warsaw (UTC+2 in September, "evening"). Passing Dubai's hour for a
    // Poland employee's dashboard — the exact regression this corrects —
    // would greet them "Good morning" while their own clock reads 10:30 PM.
    const instant = new Date("2026-09-24T20:30:00.000Z");
    const dubaiHour = getBusinessHour("Asia/Dubai", instant);
    const warsawHour = getBusinessHour("Europe/Warsaw", instant);

    expect(greetingPeriod(dubaiHour)).toBe("morning");
    expect(greetingPeriod(warsawHour)).toBe("evening");
    expect(greetingPeriod(dubaiHour)).not.toBe(greetingPeriod(warsawHour));
  });
});
