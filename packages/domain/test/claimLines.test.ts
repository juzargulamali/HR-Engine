import { describe, expect, it } from "vitest";
import { addNumberedClaimLine, CLAIM_LINE_CONFLICT_MESSAGE, type ClaimLineStore } from "../src/claimLines";

const noPause = async () => {};

/** In-memory store that behaves like the unique (claim_id, line_no) constraint. */
function memoryStore(lines: number[]): ClaimLineStore & { lines: number[] } {
  return {
    lines,
    async highestLineNo() {
      return { value: lines.length ? Math.max(...lines) : null, error: null };
    },
    async insertLine(n) {
      if (lines.includes(n)) return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      lines.push(n);
      return { error: null };
    },
  };
}

describe("addNumberedClaimLine", () => {
  it("numbers the first line 1", async () => {
    const s = memoryStore([]);
    expect(await addNumberedClaimLine(s, { pause: noPause })).toEqual({ ok: true, lineNo: 1, attempts: 1 });
  });

  it("after delete-then-add uses highest + 1, never the head-count", async () => {
    // lines 1,2,3 then line 1 deleted: a head-count would say 3 (taken)
    const s = memoryStore([2, 3]);
    expect(await addNumberedClaimLine(s, { pause: noPause })).toMatchObject({ ok: true, lineNo: 4 });
  });

  it("retries when another add takes the number between the read and the insert", async () => {
    const s = memoryStore([1]);
    let raced = false;
    const racing: ClaimLineStore = {
      highestLineNo: s.highestLineNo,
      async insertLine(n) {
        if (!raced) {
          raced = true;
          s.lines.push(n); // the other request wins number n
        }
        return s.insertLine(n);
      },
    };
    const r = await addNumberedClaimLine(racing, { pause: noPause });
    expect(r).toEqual({ ok: true, lineNo: 3, attempts: 2 });
    expect(s.lines.sort()).toEqual([1, 2, 3]);
  });

  it("stops after the bounded number of attempts with a plain message", async () => {
    const always: ClaimLineStore = {
      async highestLineNo() { return { value: 1, error: null }; },
      async insertLine() { return { error: { code: "23505", message: "duplicate key" } }; },
    };
    const r = await addNumberedClaimLine(always, { maxAttempts: 3, pause: noPause });
    expect(r).toEqual({ ok: false, reason: "conflict", message: CLAIM_LINE_CONFLICT_MESSAGE });
  });

  it("does not retry a real error", async () => {
    let inserts = 0;
    const denied: ClaimLineStore = {
      async highestLineNo() { return { value: 0, error: null }; },
      async insertLine() { inserts++; return { error: { code: "42501", message: "new row violates row-level security policy" } }; },
    };
    const r = await addNumberedClaimLine(denied, { pause: noPause });
    expect(r).toMatchObject({ ok: false, reason: "error" });
    expect(inserts).toBe(1);
  });

  it("reports a failed read of the highest number instead of guessing", async () => {
    const broken: ClaimLineStore = {
      async highestLineNo() { return { value: null, error: "could not read" }; },
      async insertLine() { throw new Error("must not insert"); },
    };
    expect(await addNumberedClaimLine(broken, { pause: noPause })).toEqual({ ok: false, reason: "error", message: "could not read" });
  });
});
