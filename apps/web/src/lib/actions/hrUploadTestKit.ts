/**
 * Test double shared by the People & HR upload action tests: an in-memory copy of the few tables the actions touch (reads, inserts and updates behave like the real
 * thing for the filters used) and an in-memory private storage (what "the browser sent" is whatever a test puts into `world.objects`). Fictional data only.
 */
type Row = Record<string, unknown>;

export const world = {
  tables: {} as Record<string, Row[]>,
  inserted: [] as { table: string; row: Row }[],
  updated: [] as { table: string; patch: Row; id: unknown }[],
  /** `${bucket}/${path}` -> bytes already in private storage (as if the browser had sent them). */
  objects: new Map<string, Uint8Array>(),
  storageLog: [] as string[],
  grants: [] as { role: string; companyId: string | null; countryCode: string | null }[],
  userId: "me",
  insertError: null as { message: string; code?: string } | null,
  signFails: false,
  nextId: 0,
};

export function resetWorld() {
  world.tables = {}; world.inserted = []; world.updated = []; world.objects = new Map(); world.storageLog = []; world.grants = []; world.userId = "me";
  world.insertError = null; world.signFails = false; world.nextId = 0;
}

export const session = () => ({ userId: world.userId, email: null, fullName: null, grants: world.grants, employeeId: null });

export function from(table: string) {
  const eq: [string, unknown][] = [];
  let gte: [string, string] | null = null;
  let patch: Row | null = null;
  const matches = () => (world.tables[table] ?? []).filter((r) => eq.every(([k, v]) => (v === null ? r[k] == null : r[k] === v)) && (!gte || String(r[gte[0]]) >= gte[1]));
  const runUpdate = () => {
    const hit = matches();
    for (const r of hit) { Object.assign(r, patch); world.updated.push({ table, patch: patch!, id: r.id }); }
    return hit;
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (k: string, v: unknown) => { eq.push([k, v]); return chain; },
    is: (k: string, v: unknown) => { eq.push([k, v]); return chain; },
    gte: (k: string, v: string) => { gte = [k, v]; return chain; },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: (patch ? runUpdate() : matches())[0] ?? null, error: null }),
    single: async () => ({ data: matches()[0] ?? null, error: null }),
    update: (p: Row) => { patch = p; return chain; },
    then: (resolve: (v: unknown) => unknown) => resolve({ data: patch ? runUpdate() : matches(), error: null }),
    insert: (row: Row) => {
      const done = () => {
        if (world.insertError) return { data: null, error: world.insertError };
        const id = `new-${++world.nextId}`;
        world.inserted.push({ table, row });
        (world.tables[table] ??= []).push({ id, created_at: new Date().toISOString(), ...row });
        return { data: { id }, error: null };
      };
      return { select: () => ({ maybeSingle: async () => done() }), then: (resolve: (v: unknown) => unknown) => resolve({ error: done().error }) };
    },
  };
  return chain;
}

export const serverClient = {
  from,
  auth: { getUser: async () => ({ data: { user: world.userId ? { id: world.userId } : null } }) },
};

export const adminClient = {
  storage: {
    from: (bucket: string) => ({
      exists: async (path: string) => ({ data: world.objects.has(`${bucket}/${path}`), error: null }),
      createSignedUploadUrl: async (path: string) => {
        world.storageLog.push(`sign:${bucket}/${path}`);
        return world.signFails ? { data: null, error: { message: "down" } } : { data: { token: `tok:${path}`, path, signedUrl: "https://example.test" }, error: null };
      },
      download: async (path: string) => {
        world.storageLog.push(`download:${bucket}/${path}`);
        const bytes = world.objects.get(`${bucket}/${path}`);
        return bytes ? { data: new Blob([bytes.slice().buffer as ArrayBuffer]), error: null } : { data: null, error: { message: "Object not found" } };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) { world.storageLog.push(`remove:${bucket}/${p}`); world.objects.delete(`${bucket}/${p}`); }
        return { data: [], error: null };
      },
    }),
  },
};

export const bytesOf = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...new TextEncoder().encode(p)] : p)));
/** A real-looking PDF of the given size (leading "%PDF-"), e.g. the 2 MB Emirates ID scan from the report. */
export const pdfBytes = (size = 64) => { const b = new Uint8Array(size).fill(0x20); b.set(new TextEncoder().encode("%PDF-1.7\n")); return b; };
export const arrives = (bucket: string, path: string, bytes: Uint8Array) => { world.objects.set(`${bucket}/${path}`, bytes); };
