import { describe, expect, it } from "vitest";
import { badgeText, dayHeading, filterMembers, initials, launcherLabel, mentionQuery, mentionsStillInText, mergeMessages, shortAgo, splitMentions, totalUnread, type ChatMessage } from "./model";

describe("unread badge", () => {
  it("shows nothing for zero, the number to 99 and 99+ beyond", () => {
    expect([0, -1, 3, 99, 100, 1500].map(badgeText)).toEqual(["", "", "3", "99", "99+", "99+"]);
  });
  it("totals the groups and describes them for a screen reader", () => {
    const g = [{ unread: 2, mentions: 0 }, { unread: 3, mentions: 1 }];
    expect(totalUnread(g)).toBe(5);
    expect(launcherLabel(g)).toBe("Open chat, 5 unread, 1 mention of you");
    expect(launcherLabel([{ unread: 0, mentions: 0 }])).toBe("Open chat");
  });
});

describe("mentions", () => {
  const ana = { userId: "a", name: "Ana Lopez" };
  const bo = { userId: "b", name: "Bo" };
  it("highlights only the @Names the server stored, longest name first, and not a longer word", () => {
    expect(splitMentions("hi @Ana Lopez and @Bo, @Bob?", [ana, bo]).map((p) => [p.text, p.mention?.userId])).toEqual([
      ["hi ", undefined], ["@Ana Lopez", "a"], [" and ", undefined], ["@Bo", "b"], [", @Bob?", undefined]]);
    expect(splitMentions("no mentions here", [ana])).toEqual([{ text: "no mentions here" }]);
    expect(splitMentions("@Someone", [])).toEqual([{ text: "@Someone" }]);
  });
  it("sends a mention only while its @Name is still in the text, once", () => {
    expect(mentionsStillInText("ping @Ana Lopez", [ana, bo])).toEqual([ana]);
    expect(mentionsStillInText("@Bo @Bo", [bo, bo])).toEqual([bo]);
    expect(mentionsStillInText("ping @Bobby", [bo])).toEqual([]);
  });
  it("opens the member list after an @ that starts a word", () => {
    expect(mentionQuery("hello @an", 9)).toEqual({ query: "an", start: 6 });
    expect(mentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(mentionQuery("mail me@x", 9)).toBeNull();
    expect(mentionQuery("no at sign", 5)).toBeNull();
  });
  it("filters members by name, names that start with the text first", () => {
    const m = [{ name: "Omar" }, { name: "Maria" }, { name: "Mo" }];
    expect(filterMembers(m, "ma").map((x) => x.name)).toEqual(["Maria", "Omar"]);
    expect(filterMembers(m, "", 2)).toHaveLength(2);
  });
});

describe("time and names", () => {
  const now = new Date(2026, 10, 10, 12, 0, 0);
  it("headings and short ages", () => {
    expect(dayHeading(new Date(2026, 10, 10, 8).toISOString(), now)).toBe("Today");
    expect(dayHeading(new Date(2026, 10, 9, 23).toISOString(), now)).toBe("Yesterday");
    expect(shortAgo(null, now)).toBe("");
    expect(shortAgo(new Date(now.getTime() - 30_000).toISOString(), now)).toBe("now");
    expect(shortAgo(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe("5m");
    expect(shortAgo(new Date(now.getTime() - 3 * 3600_000).toISOString(), now)).toBe("3h");
    expect(shortAgo(new Date(now.getTime() - 2 * 86400_000).toISOString(), now)).toBe("2d");
  });
  it("initials", () => { expect(initials("Ana Maria Lopez")).toBe("AM"); expect(initials("  ")).toBe("?"); });
});

describe("merging messages", () => {
  const m = (seq: number, body = ""): ChatMessage => ({ id: `m${seq}`, seq, senderId: "s", senderName: "S", body, createdAt: "2026-11-10T00:00:00Z", mentions: [], shared: null });
  it("orders by sequence and never duplicates", () => {
    expect(mergeMessages([m(1), m(3)], [m(2), m(3, "again")]).map((x) => [x.seq, x.body])).toEqual([[1, ""], [2, ""], [3, "again"]]);
  });
});

import { filterGroups, groupSections, membershipLine } from "./model";
describe("project groups in the list", () => {
  const groups = [{ name: "Sales — UAE", kind: "sales" as const }, { name: "UAE-P-1 · Fictional Alpha", kind: "project" as const }, { name: "Older database row" }];
  it("puts Sales groups first and project groups in their own section; a row without a kind is a Sales group", () => {
    expect(groupSections(groups).map((s) => [s.title, s.groups.length])).toEqual([["Sales", 2], ["Projects", 1]]);
    expect(groupSections([groups[1]!]).map((s) => s.title)).toEqual(["Projects"]);
  });
  it("describes who is in a group, and that a finished project is read-only", () => {
    expect(membershipLine({ kind: "sales" })).toMatch(/Sales access/);
    expect(membershipLine({ kind: "project" })).toBe("The people on this project, and the company's Operations Managers");
    expect(membershipLine({ kind: "project", readOnly: true })).toMatch(/finished/);
  });
  it("finds a group by part of its name or reference", () => {
    expect(filterGroups(groups, "p-1").map((g) => g.name)).toEqual(["UAE-P-1 · Fictional Alpha"]);
    expect(filterGroups(groups, " ")).toHaveLength(3);
  });
});

import { archivedHeading, isArchivedGroup, OPERATIONS_READER_NOTE } from "./model";
describe("archived project groups", () => {
  const sales = { name: "Sales — UAE", kind: "sales" as const, projectStatus: null, unread: 1, mentions: 0 };
  const live = { name: "UAE-P-1 · Fictional Alpha", kind: "project" as const, projectStatus: "active", unread: 2, mentions: 0 };
  const done = { name: "UAE-P-2 · Fictional Beta", kind: "project" as const, projectStatus: "completed", unread: 0, mentions: 0 };
  const old = { name: "UAE-P-3 · Fictional Gamma", kind: "project" as const, projectStatus: "archived", unread: 4, mentions: 1 };
  it("orders the sections Sales, Projects, Archived; a completed project stays under Projects", () => {
    const sections = groupSections([old, sales, live, done]);
    expect(sections.map((s) => [s.title, s.groups.map((g) => g.name), s.archived === true])).toEqual([
      ["Sales", ["Sales — UAE"], false], ["Projects", ["UAE-P-1 · Fictional Alpha", "UAE-P-2 · Fictional Beta"], false], ["Archived", ["UAE-P-3 · Fictional Gamma"], true]]);
    expect(archivedHeading(sections[2]!.groups.length)).toBe("Archived (1)");
  });
  it("leaves the Archived section out when nothing is archived, and Sales groups are never archived", () => {
    expect(groupSections([sales, live]).map((s) => s.title)).toEqual(["Sales", "Projects"]);
    expect(isArchivedGroup({ kind: "sales", projectStatus: "archived" })).toBe(false);
    expect(isArchivedGroup({ kind: "project" })).toBe(false);
  });
  it("a restored project's group is back under Projects", () => {
    expect(groupSections([sales, { ...old, projectStatus: "active" }]).map((s) => [s.title, s.groups.length])).toEqual([["Sales", 1], ["Projects", 1]]);
  });
  it("keeps an archived group's unread and mentions in the totals, and search still finds it", () => {
    expect(totalUnread([sales, live, old])).toBe(7);
    expect(launcherLabel([sales, live, old])).toBe("Open chat, 7 unread, 1 mention of you");
    expect(filterGroups([sales, live, old], "gamma")).toEqual([old]);
  });
  it("says in plain words that the reader is Operations, not on the team", () => {
    expect(OPERATIONS_READER_NOTE).toBe("You are reading this as Operations Manager. You are not on this project's team.");
  });
});
