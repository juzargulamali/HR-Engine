import { describe, expect, it } from "vitest";
import type { ProjMessageFeedRow } from "@/types/projects";
import { EARLIER_PAGE, advanceCursor, oldestSeq, splitEarlierPage } from "./discussion-paging";
import { mergeMessages } from "@/app/(app)/projects/[id]/discussion/discussion-helpers";

const msg = (seq: number, changed = `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}Z`): ProjMessageFeedRow => ({
  id: `m${seq}`, seq, parent_id: null, author_id: "u1", author_name: "Ann", body: `hello ${seq}`, created_at: changed, edited_at: null,
  deleted_at: null, changed_at: changed, mention_ids: [],
});
const newestFirst = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => msg(from - i));

describe("splitEarlierPage", () => {
  it("returns the page oldest first and says more remain when the extra row came back", () => {
    const page = splitEarlierPage(newestFirst(120, 69));           // 52 rows asked for 51
    expect(page.messages).toHaveLength(EARLIER_PAGE);
    expect(page.messages.map((m) => m.seq)).toEqual(Array.from({ length: EARLIER_PAGE }, (_, i) => 71 + i));
    expect(page.hasMore).toBe(true);
  });
  it("says nothing older remains when the page is not over-full", () => {
    const page = splitEarlierPage(newestFirst(30, 1));
    expect(page.messages).toHaveLength(30);
    expect(page.messages[0]!.seq).toBe(1);
    expect(page.hasMore).toBe(false);
  });
  it("does not say more remain for a page of exactly the page size", () => {
    expect(splitEarlierPage(newestFirst(50, 1)).hasMore).toBe(false);
  });
  it("copes with an empty page", () => {
    expect(splitEarlierPage([])).toEqual({ messages: [], hasMore: false });
    expect(oldestSeq([])).toBeNull();
  });
  it("walks the whole history exactly once, page by page", () => {
    const all = newestFirst(230, 1);
    let before = 231;
    const seen: number[] = [];
    let loaded: ProjMessageFeedRow[] = [];
    for (let guard = 0; guard < 20; guard++) {
      const rows = all.filter((m) => m.seq < before).slice(0, EARLIER_PAGE + 1);
      const { messages, hasMore } = splitEarlierPage(rows);
      loaded = mergeMessages(loaded, messages);
      seen.push(...messages.map((m) => m.seq));
      before = oldestSeq(messages) ?? before;
      if (!hasMore) break;
    }
    expect(new Set(seen).size).toBe(230);
    expect(loaded.map((m) => m.seq)).toEqual(Array.from({ length: 230 }, (_, i) => i + 1));
  });
});

describe("advanceCursor", () => {
  it("moves forward on what the live feed returns", () => {
    expect(advanceCursor({ seq: 5, changed: "2026-01-01T00:00:05Z" }, [msg(6, "2026-01-01T00:00:09Z")])).toEqual({ seq: 6, changed: "2026-01-01T00:00:09Z" });
  });
  it("never moves backwards, and ignores an empty answer", () => {
    const c = { seq: 9, changed: "2026-01-01T00:00:30Z" };
    expect(advanceCursor(c, [])).toEqual(c);
    expect(advanceCursor(c, [msg(2, "2026-01-01T00:00:02Z")])).toEqual(c);
  });
  it("starts from nothing", () => {
    expect(advanceCursor({ seq: 0, changed: null }, [msg(3, "2026-01-01T00:00:03Z")])).toEqual({ seq: 3, changed: "2026-01-01T00:00:03Z" });
  });
});
