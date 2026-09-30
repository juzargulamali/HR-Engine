import { describe, expect, it, vi } from "vitest";

// client.ts is marked "server-only" — stub it out the same way every other
// server-only unit test in this codebase does (see e.g. the cron route tests).
vi.mock("server-only", () => ({}));

import { parseJibbleEntry } from "./client";

describe("parseJibbleEntry — fail-closed parsing", () => {
  it("parses a clean, unambiguous entry", () => {
    const result = parseJibbleEntry({
      id: "e1",
      personId: "p1",
      start: "2027-01-02T08:00:00Z",
      end: "2027-01-02T13:00:00Z",
      note: "Project Falcon",
      breakMinutes: 30,
    });
    expect(result).toEqual({
      status: "parseable",
      jibbleEntryId: "e1",
      personId: "p1",
      start: "2027-01-02T08:00:00Z",
      end: "2027-01-02T13:00:00Z",
      entryStatus: "completed",
      note: "Project Falcon",
      breakMinutes: 30,
      needsReview: false,
      reviewReason: null,
      raw: expect.anything(),
    });
  });

  it("is unparseable when no id/person-id-like field exists at all", () => {
    const result = parseJibbleEntry({ start: "2027-01-02T08:00:00Z", end: "2027-01-02T13:00:00Z" });
    expect(result.status).toBe("unparseable");
  });

  it("marks entryStatus in_progress and needsReview false when end is simply absent (an open shift, not an error)", () => {
    const result = parseJibbleEntry({ id: "e2", personId: "p1", start: "2027-01-02T08:00:00Z" });
    expect(result.status).toBe("parseable");
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.entryStatus).toBe("in_progress");
    expect(result.end).toBeNull();
    expect(result.needsReview).toBe(false);
  });

  it("flags needsReview when no start-time field is recognized at all", () => {
    const result = parseJibbleEntry({ id: "e3", personId: "p1", end: "2027-01-02T13:00:00Z" });
    expect(result.status).toBe("parseable");
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.start).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/No recognizable start-time field/);
  });

  it("treats a genuinely absent breaks field as zero, not ambiguous", () => {
    const result = parseJibbleEntry({ id: "e4", personId: "p1", start: "2027-01-02T08:00:00Z", end: "2027-01-02T13:00:00Z" });
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.breakMinutes).toBe(0);
    expect(result.needsReview).toBe(false);
  });

  it("flags an unrecognized breaks shape instead of silently treating it as zero", () => {
    const result = parseJibbleEntry({
      id: "e5",
      personId: "p1",
      start: "2027-01-02T08:00:00Z",
      end: "2027-01-02T13:00:00Z",
      breaks: "lunch, 30 minutes", // not an array or number — unrecognized
    });
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/not an array or number/);
  });

  it("sums a recognized breaks array of {durationMinutes} objects", () => {
    const result = parseJibbleEntry({
      id: "e6",
      personId: "p1",
      start: "2027-01-02T08:00:00Z",
      end: "2027-01-02T13:00:00Z",
      breaks: [{ durationMinutes: 15 }, { durationMinutes: 15 }],
    });
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.breakMinutes).toBe(30);
    expect(result.needsReview).toBe(false);
  });

  it("flags disagreeing candidate fields instead of silently picking one", () => {
    const result = parseJibbleEntry({
      id: "e7",
      personId: "p1",
      start: "2027-01-02T08:00:00Z",
      end: "2027-01-02T13:00:00Z",
      note: "Project A",
      comment: "Project B", // a DIFFERENT value under another note-like candidate key
    });
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/Multiple note-like fields disagree/);
  });

  it("does not flag disagreeing candidates when they actually agree", () => {
    const result = parseJibbleEntry({
      id: "e8",
      personId: "p1",
      start: "2027-01-02T08:00:00Z",
      end: "2027-01-02T13:00:00Z",
      note: "Project A",
      comment: "Project A", // same value — not a real conflict
    });
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.needsReview).toBe(false);
  });

  it("flags an unparseable start-time string rather than passing it through", () => {
    const result = parseJibbleEntry({ id: "e9", personId: "p1", start: "not-a-date", end: "2027-01-02T13:00:00Z" });
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.start).toBeNull();
    expect(result.needsReview).toBe(true);
    expect(result.reviewReason).toMatch(/not a parseable timestamp/);
  });

  it("always preserves the full raw payload regardless of parse outcome", () => {
    const raw = { id: "e10", personId: "p1", start: "2027-01-02T08:00:00Z", someUnknownField: 42 };
    const result = parseJibbleEntry(raw);
    if (result.status !== "parseable") throw new Error("unreachable");
    expect(result.raw).toBe(raw);
  });
});
