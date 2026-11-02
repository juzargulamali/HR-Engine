/**
 * A tiny stand-in for the Supabase client for tests of "what the page shows when a read fails". Every table (and rpc) answers with the
 * result the test gives it, whatever filters are chained, so a test can make exactly one source fail and see what the screen does.
 * Not a query engine: the rows are returned as given.
 */
export type FakeResult = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };

const ok = (data: unknown, count: number | null = null): FakeResult => ({ data, error: null, count });
export const failing = (message = "the data service did not answer"): FakeResult => ({ data: null, error: { message }, count: null });
export const rows = (data: unknown[]): FakeResult => ok(data, data.length);
export const row = (data: unknown): FakeResult => ok(data);

function chain(result: () => FakeResult) {
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: FakeResult) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
      return () => proxy;
    },
    apply: () => proxy,
  });
  return proxy;
}

/** `tables` and `rpcs` map a name to a result, or to a function that returns one (called on every query, so a table can answer differently the second time). */
export function fakeSupabase(
  tables: Record<string, FakeResult | (() => FakeResult)> = {},
  rpcs: Record<string, FakeResult | (() => FakeResult)> = {},
  user: { id: string } | null = { id: "user-1" },
) {
  const pick = (m: Record<string, FakeResult | (() => FakeResult)>, name: string) => () => {
    const r = m[name];
    return r === undefined ? rows([]) : typeof r === "function" ? r() : r;
  };
  return {
    from: (table: string) => chain(pick(tables, table)),
    rpc: (name: string) => chain(pick(rpcs, name)),
    auth: { getUser: async () => ({ data: { user } }) },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  };
}
