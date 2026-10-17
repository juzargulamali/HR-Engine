import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
type AnyFn = (...a: unknown[]) => unknown;
const rpc = vi.fn<AnyFn>();
const remove = vi.fn<AnyFn>();
const buckets: string[] = [];
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, storage: { from: (b: string) => ({ remove: (...a: unknown[]) => { buckets.push(b); return remove(...a); } }) } }) }));

import { purgeExpiredUploads } from "./upload-cleanup";

beforeEach(() => { rpc.mockReset(); remove.mockReset().mockResolvedValue({ error: null }); buckets.length = 0; });

describe("purgeExpiredUploads", () => {
  it("removes the quarantine copy of every swept intent, and the real-bucket copy only when validated but never registered", async () => {
    rpc.mockResolvedValue({ data: [
      { quarantine_path: "c/o/i1-a.pdf", final_path: "c/o/f1-a.pdf", orphaned_validated: false },
      { quarantine_path: "c/o/i2-b.pdf", final_path: "c/o/f2-b.pdf", orphaned_validated: true },
    ], error: null });
    const r = await purgeExpiredUploads();
    expect(r).toEqual({ intentsSwept: 2, quarantineObjectsRemoved: 2, orphanedValidatedRemoved: 1, failures: 0 });
    expect(remove).toHaveBeenCalledWith(["c/o/i1-a.pdf"]);
    expect(remove).toHaveBeenCalledWith(["c/o/i2-b.pdf"]);
    expect(remove).toHaveBeenCalledWith(["c/o/f2-b.pdf"]);
    expect(remove).not.toHaveBeenCalledWith(["c/o/f1-a.pdf"]); // a registered or never-validated file is never deleted from crm-files
    expect(buckets.filter((b) => b === "crm-files")).toHaveLength(1);
  });
  it("counts storage failures without stopping, and does nothing when there is nothing to sweep", async () => {
    rpc.mockResolvedValue({ data: [{ quarantine_path: "a", final_path: "b", orphaned_validated: true }], error: null });
    remove.mockResolvedValue({ error: { message: "nope" } });
    expect(await purgeExpiredUploads()).toMatchObject({ intentsSwept: 1, failures: 2 });
    rpc.mockResolvedValue({ data: [], error: null });
    remove.mockClear();
    expect(await purgeExpiredUploads()).toEqual({ intentsSwept: 0, quarantineObjectsRemoved: 0, orphanedValidatedRemoved: 0, failures: 0 });
    expect(remove).not.toHaveBeenCalled();
  });
  it("surfaces a failed sweep instead of hiding it", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    await expect(purgeExpiredUploads()).rejects.toThrow(/boom/);
  });
});
