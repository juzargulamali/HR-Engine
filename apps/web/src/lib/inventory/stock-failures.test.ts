import { describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, row } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let rpcResult = row({ usable_now: 5 });
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase({}, { inv_availability: () => rpcResult }) }));

import { fillSummaryUsable } from "./stock";
import type { StockRow } from "./stock-list";
import type { InvLocationRow } from "@/types/inventory";

const stockRow = { id: "i1", companyId: "c1", detail: false, status: "active", usable: null } as unknown as StockRow;
const location = { id: "l1", company_id: "c1", is_active: true } as InvLocationRow;

describe("fillSummaryUsable", () => {
  it("healthy: the number comes from the database's availability function", async () => {
    rpcResult = row({ usable_now: 5 });
    expect((await fillSummaryUsable([stockRow], [location], ""))[0]?.usable).toBe(5);
  });
  it("a failed availability call is null ('could not be checked', shown as a dash), never 0 available", async () => {
    rpcResult = failing();
    expect((await fillSummaryUsable([stockRow], [location], ""))[0]?.usable).toBeNull();
  });
  it("a genuine zero is still 0", async () => {
    rpcResult = row({ usable_now: 0 });
    expect((await fillSummaryUsable([stockRow], [location], ""))[0]?.usable).toBe(0);
  });
});
