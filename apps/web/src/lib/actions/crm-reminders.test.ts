import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { markRemindersRead } from "./crm";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: 1, error: null }); });

describe("marking reminders read", () => {
  it("dismissing the one reminder shown for a follow-up marks every row behind it: one database call per row", async () => {
    expect(await markRemindersRead([A, B])).toEqual({ error: null, marked: 2, failed: 0 });
    expect(rpc.mock.calls).toEqual([["crm_mark_reminder_read", { p_reminder_id: A }], ["crm_mark_reminder_read", { p_reminder_id: B }]]);
  });

  it("the same id twice is one call, and a single id still works", async () => {
    await markRemindersRead([A, A]);
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear();
    expect((await markRemindersRead(A)).error).toBeNull();
    expect(rpc).toHaveBeenCalledWith("crm_mark_reminder_read", { p_reminder_id: A });
  });

  it("no argument marks all of the person's reminders in one call; an EMPTY list marks nothing (never everything)", async () => {
    await markRemindersRead();
    expect(rpc.mock.calls).toEqual([["crm_mark_reminder_read", { p_reminder_id: null }]]);
    rpc.mockClear();
    expect(await markRemindersRead([])).toEqual({ error: null, marked: 0, failed: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a partial failure is said, with the numbers: one sibling marked, one not", async () => {
    rpc.mockImplementation(async (_fn: string, args: { p_reminder_id: string }) => (args.p_reminder_id === B ? { data: null, error: { message: "down" } } : { data: 1, error: null }));
    const r = await markRemindersRead([A, B]);
    expect(r.marked).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.error).toMatch(/Only partly dismissed: 1 of 2/);
  });

  it("a total failure is an error, not silence, also when the call itself throws", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await markRemindersRead([A])).error).toMatch(/could not be dismissed/);
    expect((await markRemindersRead()).error).toMatch(/could not be marked read/);
    rpc.mockRejectedValue(new Error("network"));
    expect(await markRemindersRead([A, B])).toMatchObject({ failed: 2, marked: 0 });
  });
});
