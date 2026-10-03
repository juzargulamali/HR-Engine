import { describe, expect, it } from "vitest";
import {
  buildRecoveryPeriods,
  classifyRecoveryDay,
  computeWindowEntitlement,
  DEFAULT_RECOVERY_WINDOW_RULES,
  describeRecoveryStatus,
  formatRecordedDuration,
  isWeeklyRestDay,
  parseRecoveryWindowRules,
  recoveryWindowRulesToPayload,
  renderRecoveryWindowPolicyWording,
  type WorkInterval,
} from "../src/recoveryWindows";
import { getBusinessDateString } from "../src/businessTime";

const toBusinessDate = (instant: Date, tz: string) => getBusinessDateString(tz, instant);

const H = 3600;
const T0 = Date.UTC(2026, 10, 2, 6, 0, 0); // Mon 2026-11-02 06:00Z

const iv = (id: string, startH: number, endH: number | null, extra: Partial<WorkInterval> = {}): WorkInterval => ({
  id,
  startMs: T0 + startH * 3_600_000,
  endMs: endH === null ? null : T0 + endH * 3_600_000,
  ...extra,
});
const at = (h: number) => T0 + h * 3_600_000;

describe("computeWindowEntitlement — normal working day", () => {
  const cases: [number, number][] = [
    [0, 0],
    [9 * H, 0],
    [13 * H, 0], // exactly 13h = nothing
    [13 * H + 1, 0.5], // 13h 0m 1s
    [17 * H, 0.5], // exactly 17h
    [17 * H + 1, 1], // 17h 0m 1s
    [24 * H, 1], // never more than 1 day
  ];
  it.each(cases)("%i recorded seconds -> %f day(s)", (seconds, days) => {
    expect(computeWindowEntitlement("normal_day", seconds).days).toBe(days);
  });
});

describe("computeWindowEntitlement — rest day and public holiday", () => {
  const cases: [number, number][] = [
    [1, 0],
    [2 * H - 1, 0], // 1h 59m 59s
    [2 * H, 0.5],
    [6 * H, 0.5], // exactly 6h
    [6 * H + 1, 1],
    [24 * H, 1],
  ];
  it.each(cases)("%i recorded seconds -> %f day(s)", (seconds, days) => {
    expect(computeWindowEntitlement("rest_day", seconds).days).toBe(days);
    expect(computeWindowEntitlement("public_holiday", seconds).days).toBe(days);
  });
});

describe("classification", () => {
  it("counts a holiday on a rest day once, as a single classification", () => {
    expect(classifyRecoveryDay({ isPublicHoliday: true, isWeeklyRestDay: true })).toBe("public_holiday");
    expect(classifyRecoveryDay({ isPublicHoliday: false, isWeeklyRestDay: true })).toBe("rest_day");
    expect(classifyRecoveryDay({ isPublicHoliday: false, isWeeklyRestDay: false })).toBe("normal_day");
  });

  it("uses the configured working week: UAE/PL Mon–Fri, KSA Sun–Thu", () => {
    const monFri = [1, 2, 3, 4, 5];
    const sunThu = [0, 1, 2, 3, 4];
    expect(isWeeklyRestDay("2026-11-06", monFri)).toBe(false); // Friday
    expect(isWeeklyRestDay("2026-11-07", monFri)).toBe(true); // Saturday
    expect(isWeeklyRestDay("2026-11-08", monFri)).toBe(true); // Sunday
    expect(isWeeklyRestDay("2026-11-06", sunThu)).toBe(true); // Friday is KSA rest
    expect(isWeeklyRestDay("2026-11-07", sunThu)).toBe(true); // Saturday
    expect(isWeeklyRestDay("2026-11-08", sunThu)).toBe(false); // Sunday is KSA working
  });

  it("classifies a Friday-evening start that runs into Saturday by the START date only", () => {
    // KSA: Thursday 20:00 local start runs 18h into Friday — one window, classified Thursday (normal).
    const startUtc = new Date(Date.UTC(2026, 10, 5, 17, 0, 0)); // Thu 20:00 Riyadh
    const startDate = toBusinessDate(startUtc, "Asia/Riyadh");
    expect(startDate).toBe("2026-11-05");
    expect(isWeeklyRestDay(startDate, [0, 1, 2, 3, 4])).toBe(false);
  });

  it("uses the employee's timezone, not the device's, to find the starting local date", () => {
    const instant = new Date(Date.UTC(2026, 10, 6, 21, 30, 0)); // 21:30Z Friday
    expect(toBusinessDate(instant, "Asia/Dubai")).toBe("2026-11-07"); // already Saturday in UAE (+4)
    expect(toBusinessDate(instant, "Europe/Warsaw")).toBe("2026-11-06"); // still Friday in Poland (+1)
  });
});

describe("buildRecoveryPeriods — working periods", () => {
  it("joins sessions separated by a gap shorter than 8h; mode switch does not matter", () => {
    const [p, ...rest] = buildRecoveryPeriods(
      [iv("a", 0, 4, { workMode: "office" }), iv("b", 4, 6, { workMode: "wfh" }), iv("c", 6 + 7 + 59 / 60 + 59 / 3600, 20, { workMode: "site_work" })],
      at(40),
    );
    expect(rest).toHaveLength(0);
    expect(p!.gaps).toHaveLength(1);
  });

  it("7h59m59s gap keeps one period; exactly 8h starts a fresh one", () => {
    const keep = buildRecoveryPeriods([iv("a", 0, 4), iv("b", 4 + 8 - 1 / 3600, 8)], at(100));
    expect(keep).toHaveLength(1);
    const split = buildRecoveryPeriods([iv("a", 0, 4), iv("b", 4 + 8, 14)], at(100));
    expect(split).toHaveLength(2);
  });

  it("14h + 2h off + 4h = 18h recorded in one window = 1 day, with no 20h alert", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, 14), iv("b", 16, 20)], at(60));
    expect(p!.recordedSeconds).toBe(18 * H);
    expect(p!.windows).toHaveLength(1);
    expect(computeWindowEntitlement("normal_day", p!.windows[0]!.recordedSeconds).days).toBe(1);
    expect(p!.longWorkTriggerMs).toBeNull();
    expect(p!.elapsedSeconds).toBe(20 * H);
  });

  it("flexible start times are anchored to the real first clock-in, not a fixed hour", () => {
    const [p] = buildRecoveryPeriods([iv("a", 3.25, 12.5)], at(80));
    expect(p!.startMs).toBe(at(3.25));
    expect(p!.windows[0]!.startMs).toBe(at(3.25));
    expect(p!.windows[0]!.endMs).toBe(at(3.25 + 24));
  });

  it("an exactly-13h and a 13h01s day produce the right bands end to end", () => {
    const [a] = buildRecoveryPeriods([iv("a", 0, 13)], at(100));
    expect(computeWindowEntitlement("normal_day", a!.windows[0]!.recordedSeconds).days).toBe(0);
    const [b] = buildRecoveryPeriods([{ id: "x", startMs: T0, endMs: T0 + 13 * 3_600_000 + 1000 }], at(100));
    expect(computeWindowEntitlement("normal_day", b!.windows[0]!.recordedSeconds).days).toBe(0.5);
  });
});

describe("buildRecoveryPeriods — 20h alert", () => {
  it("fires exactly when accumulated recorded work reaches 20h, once, at the right instant", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, 10), iv("b", 12, 30)], at(80));
    // 10h + 10h more reaches 20h at elapsed 22h.
    expect(p!.longWorkTriggerMs).toBe(at(22));
  });

  it("is not reached by 19h59m59s", () => {
    const [p] = buildRecoveryPeriods([{ id: "a", startMs: T0, endMs: T0 + 20 * 3_600_000 - 1000 }], at(80));
    expect(p!.longWorkTriggerMs).toBeNull();
  });

  it("includes a running session up to asOf, reached by exactly asOf = 20h", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, null)], at(20));
    expect(p!.longWorkTriggerMs).toBe(at(20));
    expect(p!.hasOpenInterval).toBe(true);
    expect(p!.restCompletesAtMs).toBeNull();
  });
});

describe("buildRecoveryPeriods — 24 elapsed-hour windows", () => {
  it("splits one open session across 24h boundaries without a clock-out, preserving every second", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, null)], at(50));
    expect(p!.windows).toHaveLength(3);
    expect(p!.windows.map((w) => w.recordedSeconds)).toEqual([24 * H, 24 * H, 2 * H]);
    expect(p!.windows.map((w) => w.closed)).toEqual([true, true, false]);
    expect(p!.windows[0]!.closedReason).toBe("elapsed_window");
    expect(p!.rollovers.map((r) => r.atMs)).toEqual([at(24), at(48)]);
    expect(p!.recordedSeconds).toBe(50 * H);
    // each window allocation points at the same raw interval; no clock-out was fabricated
    expect(p!.windows.every((w) => w.allocations.every((a) => a.intervalId === "a"))).toBe(true);
  });

  it("splits a finished session that crosses a boundary and conserves seconds", () => {
    const [p] = buildRecoveryPeriods([iv("a", 20, 30)], at(80));
    expect(p!.windows).toHaveLength(1); // window 1 is 20..44 -> 20..30 is in window 1
    const [q] = buildRecoveryPeriods([iv("a", 0, 18), iv("b", 20, 30)], at(80));
    expect(q!.windows).toHaveLength(2);
    expect(q!.windows[0]!.recordedSeconds).toBe(18 * H + 4 * H);
    expect(q!.windows[1]!.recordedSeconds).toBe(6 * H);
    const total = q!.windows.reduce((sum, w) => sum + w.recordedSeconds, 0);
    expect(total).toBe(q!.recordedSeconds);
  });

  it("a boundary that falls during a gap places each side in the right window", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, 23), iv("b", 25, 30)], at(80));
    expect(p!.windows.map((w) => w.recordedSeconds)).toEqual([23 * H, 5 * H]);
    expect(p!.gaps).toEqual([{ startMs: at(23), endMs: at(25) }]);
  });

  it("emits no window (and so no request) for an empty window inside a long gap", () => {
    // gap of 7h59 keeps one period, but a window with no work in it is never produced.
    const [p] = buildRecoveryPeriods([iv("a", 0, 1), iv("b", 8.9, 9.5)], at(80));
    expect(p!.windows).toHaveLength(1);
    const split = buildRecoveryPeriods([iv("a", 0, 10), iv("b", 40, 41)], at(200));
    expect(split).toHaveLength(2);
    expect(split[1]!.windows).toHaveLength(1);
    expect(split[1]!.windows[0]!.startMs).toBe(at(40));
  });

  it("a delayed worker (asOf far later) still derives every boundary deterministically", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, null)], at(24 * 5 + 1));
    expect(p!.windows).toHaveLength(6);
    expect(p!.rollovers).toHaveLength(5);
    expect(p!.recordedSeconds).toBe((24 * 5 + 1) * H);
  });

  it("closes a window early when 8h of rest completes before its 24h boundary, and rollover never counts as rest", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, 10)], at(18));
    expect(p!.ended).toBe(true);
    expect(p!.windows[0]!.closed).toBe(true);
    expect(p!.windows[0]!.closedReason).toBe("rest");
    expect(p!.windows[0]!.closedAtMs).toBe(at(18));
    expect(p!.rollovers).toHaveLength(0);

    // Not yet rested at the 24h boundary (gap < 8h to next session): rollover is recorded.
    const [q] = buildRecoveryPeriods([iv("a", 0, 23.5), iv("b", 26, 30)], at(40));
    expect(q!.rollovers.map((r) => r.atMs)).toEqual([at(24)]);
  });

  it("manufactures no window after an actual rest", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, 10)], at(200));
    expect(p!.windows).toHaveLength(1);
    expect(p!.rollovers).toHaveLength(0);
  });

  it("an open window stays open (and provisional) until it is closed", () => {
    const [p] = buildRecoveryPeriods([iv("a", 0, 12)], at(15));
    expect(p!.ended).toBe(false);
    expect(p!.windows[0]!.closed).toBe(false);
  });

  it("a Warsaw DST change does not alter real elapsed durations", () => {
    // Europe/Warsaw springs forward 2027-03-28 01:00Z. 24 real hours across it.
    const start = Date.UTC(2027, 2, 27, 12, 0, 0);
    const [p] = buildRecoveryPeriods([{ id: "a", startMs: start, endMs: null }], start + 30 * 3_600_000);
    expect(p!.windows[0]!.endMs - p!.windows[0]!.startMs).toBe(24 * 3_600_000);
    expect(p!.windows[0]!.recordedSeconds).toBe(24 * H);
    expect(p!.windows[1]!.recordedSeconds).toBe(6 * H);
    expect(toBusinessDate(new Date(p!.windows[0]!.startMs), "Europe/Warsaw")).toBe("2027-03-27");
  });

  it("window seconds always reconcile to the raw interval total", () => {
    const intervals = [iv("a", 0, 7.3), iv("b", 9, 19.77), iv("c", 22, 23.1), iv("d", 26.9, null)];
    const [p] = buildRecoveryPeriods(intervals, at(60));
    const raw = 7.3 * H + (19.77 - 9) * H + 1.1 * H + (60 - 26.9) * H;
    expect(Math.abs(p!.recordedSeconds - raw)).toBeLessThan(1);
    expect(p!.windows.reduce((s, w) => s + w.recordedSeconds, 0)).toBe(p!.recordedSeconds);
  });
});

describe("policy rule payload and wording", () => {
  it("round-trips the default rules", () => {
    const parsed = parseRecoveryWindowRules(recoveryWindowRulesToPayload(DEFAULT_RECOVERY_WINDOW_RULES));
    expect(parsed).toEqual({ rules: DEFAULT_RECOVERY_WINDOW_RULES });
  });

  it("rejects incoherent rules in plain English", () => {
    const payload = recoveryWindowRulesToPayload({ ...DEFAULT_RECOVERY_WINDOW_RULES, normalDay: { zeroMaxHours: 17, halfMaxHours: 13 } });
    const parsed = parseRecoveryWindowRules(payload);
    expect("issues" in parsed && parsed.issues.join(" ")).toMatch(/zero_max_hours must be less/);
    expect("issues" in parseRecoveryWindowRules({})).toBe(true);
  });

  it("generates wording from the same numbers the engine uses", () => {
    const text = renderRecoveryWindowPolicyWording(DEFAULT_RECOVERY_WINDOW_RULES);
    expect(text).toContain("up to and including 13 recorded hours earns nothing");
    expect(text).toContain("up to and including 17 hours earns 0.5 day");
    expect(text).toContain("under 2 recorded hours earns nothing");
    expect(text).toContain("up to and including 6 hours earns 0.5 day");
    expect(text).toContain("20 hours without a 8-hour rest");
    expect(text).toContain("180 days");
    expect(text).not.toMatch(/Jibble|break/i);
  });
});

describe("presentation helpers", () => {
  it("never presents provisional credit as available", () => {
    expect(describeRecoveryStatus({ windowClosed: false, entitlementDays: 0.5, requestStatus: null }).label).toBe("Awaiting closure");
    expect(describeRecoveryStatus({ windowClosed: true, entitlementDays: 1, requestStatus: "pending_approval" }).label).toBe("Awaiting approval");
    expect(describeRecoveryStatus({ windowClosed: true, entitlementDays: 1, requestStatus: "approved" }).status).toBe("approved");
    expect(describeRecoveryStatus({ windowClosed: true, entitlementDays: 0, requestStatus: null }).status).toBe("none");
  });

  it("formats exact durations", () => {
    expect(formatRecordedDuration(13 * H + 65)).toBe("13h 01m 05s");
    expect(formatRecordedDuration(-5)).toBe("0h 00m 00s");
  });
});
