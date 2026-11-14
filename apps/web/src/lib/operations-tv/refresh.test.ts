import { describe, expect, it } from "vitest";
import { board } from "./fixtures";
import { canStart, initialRefresh, refreshReducer, type TvRefreshState } from "./refresh";

const ok = (s: TvRefreshState, at = 1000) => refreshReducer(s, { type: "result", result: { kind: "ok", board: board() }, at });
describe("refresh state", () => {
  it("one request at a time", () => {
    const s = refreshReducer(initialRefresh, { type: "start" });
    expect(canStart(s)).toBe(false);
    expect(refreshReducer(s, { type: "start" })).toBe(s);
  });
  it("a transient failure keeps the last good board, marked stale", () => {
    const s = refreshReducer(ok(initialRefresh), { type: "result", result: { kind: "transient" }, at: 2000 });
    expect(s.status).toBe("stale"); expect(s.board).not.toBeNull(); expect(s.lastOkAt).toBe(1000);
  });
  it("a transient failure with nothing yet is an error, not a blank board", () => {
    expect(refreshReducer(initialRefresh, { type: "result", result: { kind: "transient" }, at: 1 }).status).toBe("error");
  });
  it("a good read after a failure recovers", () => { expect(ok(refreshReducer(ok(initialRefresh), { type: "result", result: { kind: "transient" }, at: 2 }), 3).status).toBe("ok"); });
  it.each(["revoked", "denied", "signed_out", "not_installed"] as const)("%s clears the board at once and stops polling", (kind) => {
    const s = refreshReducer(ok(initialRefresh), { type: "result", result: { kind }, at: 5 });
    expect(s.board).toBeNull(); expect(s.status).toBe(kind); expect(canStart(s)).toBe(false);
  });
  it("goes stale with no failure when reads stop for too long (a sleeping tab)", () => {
    expect(refreshReducer(ok(initialRefresh, 0), { type: "tick", now: 100_000 }).status).toBe("ok");
    expect(refreshReducer(ok(initialRefresh, 0), { type: "tick", now: 200_000 }).status).toBe("stale");
  });
});
