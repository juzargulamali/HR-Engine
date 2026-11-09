import { describe, expect, it } from "vitest";
import { createSaveQueue, type SaveOutcome } from "./save-queue";

const ok: SaveOutcome = { ok: true, attention: null };
const gate = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("estimate save queue", () => {
  it("asks made while a save is waiting share one request", async () => {
    const g = gate(); let runs = 0;
    const q = createSaveQueue(async () => { runs += 1; return ok; });
    const blocker = q.exclusive(() => g.p);
    const a = q.save(), b = q.save(), c = q.save();
    g.open();
    await blocker;
    await Promise.all([a, b, c]);
    expect(runs).toBe(1);
  });
  it("an ask made while a save is RUNNING queues exactly one more, which runs after it (so it includes the edits made meanwhile)", async () => {
    const g = gate(); let runs = 0; let running = 0; let maxRunning = 0;
    const q = createSaveQueue(async () => { runs += 1; running += 1; maxRunning = Math.max(maxRunning, running); if (runs === 1) await g.p; running -= 1; return ok; });
    const first = q.save();
    await tick();
    const second = q.save(), third = q.save();
    expect(second).toBe(third);
    g.open();
    await Promise.all([first, second, third]);
    expect(runs).toBe(2);
    expect(maxRunning).toBe(1);   // never two saves at once: no duplicate items
  });
  it("exclusive steps run after the work queued before them and before anything queued later", async () => {
    const order: string[] = []; const g = gate();
    const q = createSaveQueue(async () => { order.push("save"); await g.p; return ok; });
    const s = q.save();
    const e = q.exclusive(async () => { order.push("step"); });
    const s2 = q.save();
    g.open();
    await Promise.all([s, e, s2]);
    expect(order).toEqual(["save", "step", "save"]);
  });
  it("a failing save reports the failure to its callers and does not block the next one", async () => {
    let n = 0;
    const q = createSaveQueue(async () => { n += 1; if (n === 1) throw new Error("network"); return ok; });
    expect(await q.save()).toMatchObject({ ok: false });
    expect(q.last).toMatchObject({ ok: false });
    expect(await q.save()).toEqual(ok);
    expect(q.last).toEqual(ok);
  });
  it("a failing exclusive step rejects its caller but the queue keeps going", async () => {
    const q = createSaveQueue(async () => ok);
    await expect(q.exclusive(async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await q.save()).toEqual(ok);
    expect(q.busy).toBe(false);
  });
  it("idle() waits for a running save AND a tracked upload, and returns the latest save outcome", async () => {
    const g = gate(); const up = gate(); let done = false;
    const q = createSaveQueue(async () => { await g.p; return { ok: false, message: "Could not save" }; });
    void q.save();
    void q.track(up.p);
    const idle = q.idle().then((o) => { done = true; return o; });
    await tick();
    expect(q.busy).toBe(true);
    g.open(); await tick();
    expect(done).toBe(false);   // the upload is still going
    up.open();
    expect(await idle).toEqual({ ok: false, message: "Could not save" });
    expect(q.busy).toBe(false);
  });
  it("idle() also waits for a save that was asked for while the upload finished", async () => {
    const up = gate(); let runs = 0;
    const q = createSaveQueue(async () => { runs += 1; return ok; });
    const tracked = q.track(up.p.then(() => { void q.save(); }));
    const idle = q.idle();
    up.open(); await tracked;
    await idle;
    expect(runs).toBe(1);
    expect(q.busy).toBe(false);
  });
  it("notifies subscribers when busy changes", async () => {
    const q = createSaveQueue(async () => ok); const seen: boolean[] = [];
    const off = q.subscribe(() => seen.push(q.busy));
    await q.save();
    off();
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
  });
});
