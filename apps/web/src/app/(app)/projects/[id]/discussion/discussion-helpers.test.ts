import { describe, expect, it } from "vitest";
import type { ProjMessageFeedRow } from "@/types/projects";
import { connectionState, countNewFromOthers, extractMentionIds, groupThreads, highlightMentions, maxChangedAt, maxSeq, mergeMessages, nextPollDelay } from "./discussion-helpers";

const msg = (seq: number, over: Partial<ProjMessageFeedRow> = {}): ProjMessageFeedRow => ({
  id: `m${seq}`, seq, parent_id: null, author_id: "u1", author_name: "Ann", body: `hello ${seq}`, created_at: `2026-01-01T00:00:0${seq}Z`, edited_at: null,
  deleted_at: null, changed_at: `2026-01-01T00:00:0${seq}Z`, mention_ids: [], ...over,
});

describe("mergeMessages", () => {
  it("adds new messages in sequence order and never duplicates", () => {
    const merged = mergeMessages([msg(1), msg(2)], [msg(3), msg(2)]);
    expect(merged.map((m) => m.seq)).toEqual([1, 2, 3]);
  });
  it("lets an edit or a deletion replace the older copy", () => {
    const edited = msg(2, { body: "edited", changed_at: "2026-01-01T00:10:00Z", edited_at: "2026-01-01T00:10:00Z" });
    const deleted = msg(1, { body: "", deleted_at: "2026-01-01T00:11:00Z", changed_at: "2026-01-01T00:11:00Z" });
    const merged = mergeMessages([msg(1), msg(2)], [edited, deleted]);
    expect(merged[1]!.body).toBe("edited");
    expect(merged[0]!.deleted_at).not.toBeNull();
  });
  it("does not let an older copy overwrite a newer one", () => {
    const newer = msg(1, { body: "new", changed_at: "2026-02-01T00:00:00Z" });
    expect(mergeMessages([newer], [msg(1)])[0]!.body).toBe("new");
  });
  it("finds the cursors", () => {
    expect(maxSeq([])).toBe(0);
    expect(maxSeq([msg(2), msg(5)])).toBe(5);
    expect(maxChangedAt([])).toBeNull();
    expect(maxChangedAt([msg(1), msg(3)])).toBe("2026-01-01T00:00:03Z");
  });
  it("counts only new messages by other people", () => {
    expect(countNewFromOthers([msg(1)], [msg(1), msg(2, { author_id: "me" }), msg(3), msg(4, { deleted_at: "x" })], "me")).toBe(1);
  });
});

describe("nextPollDelay", () => {
  it("polls about every 8 seconds while visible and once a minute while hidden", () => {
    expect(nextPollDelay(true, 0)).toBe(8000);
    expect(nextPollDelay(false, 0)).toBe(60000);
  });
  it("backs off exponentially after failures and never beyond a minute", () => {
    expect(nextPollDelay(true, 1)).toBe(16000);
    expect(nextPollDelay(true, 2)).toBe(32000);
    expect(nextPollDelay(true, 3)).toBe(60000);
    expect(nextPollDelay(true, 50)).toBe(60000);
    expect(nextPollDelay(false, 5)).toBe(60000);
  });
  it("is honest about the connection", () => {
    expect(connectionState(0)).toBe("ok");
    expect(connectionState(1)).toBe("reconnecting");
    expect(connectionState(4)).toBe("failed");
  });
});

describe("mentions", () => {
  const people = [{ id: "a", name: "Ann Lee" }, { id: "b", name: "Ann" }, { id: "c", name: "Bo" }];
  it("records only picked people whose @name is still in the text", () => {
    expect(extractMentionIds("Thanks @Ann Lee and @Bo", [people[0]!, people[2]!]).sort()).toEqual(["a", "c"]);
    expect(extractMentionIds("Thanks Bo, no at sign", people)).toEqual([]);
    expect(extractMentionIds("@Ann only", [people[1]!])).toEqual(["b"]);
  });
  it("highlights the longest known name first and leaves other @ text alone", () => {
    const segs = highlightMentions("Hi @Ann Lee, cc @Bo and @nobody", people.map((p) => p.name));
    expect(segs.filter((s) => s.mention).map((s) => s.text)).toEqual(["@Ann Lee", "@Bo"]);
    expect(segs.map((s) => s.text).join("")).toBe("Hi @Ann Lee, cc @Bo and @nobody");
  });
  it("returns plain text when there is nothing to highlight", () => {
    expect(highlightMentions("plain", ["Ann"])).toEqual([{ text: "plain", mention: false }]);
  });
});

describe("groupThreads", () => {
  it("puts replies under their root, one level deep, in order", () => {
    const t = groupThreads([msg(1), msg(2, { parent_id: "m1" }), msg(3, { parent_id: "m2" }), msg(4)]);
    expect(t.map((x) => x.root.id)).toEqual(["m1", "m4"]);
    expect(t[0]!.replies.map((r) => r.id)).toEqual(["m2", "m3"]);
  });
  it("shows a reply on its own when its parent is not loaded", () => {
    const t = groupThreads([msg(5, { parent_id: "missing" })]);
    expect(t).toHaveLength(1);
    expect(t[0]!.root.id).toBe("m5");
  });
});
