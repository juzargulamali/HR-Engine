// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let user: { id: string } | null = { id: "u1" };
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
const loadNote = vi.fn();
vi.mock("@/lib/inventory/project-notes-data", () => ({ loadNote: (...a: unknown[]) => loadNote(...a) }));
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: async () => Buffer.from("%PDF-1.7 test") }));
vi.mock("@/lib/pdf/note-document", () => ({ NoteDocument: () => null }));

import { GET } from "./route";

const P = "11111111-1111-4111-8111-111111111111";
const N = "22222222-2222-4222-8222-222222222222";
const call = (id = P, noteId = N) => GET(new Request("http://x"), { params: Promise.resolve({ id, noteId }) });

beforeEach(() => { user = { id: "u1" }; loadNote.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("note PDF route", () => {
  it("is 404 for an address that is not two ids, without reading anything", async () => {
    expect((await call("nope", N)).status).toBe(404);
    expect(loadNote).not.toHaveBeenCalled();
  });
  it("asks a signed-out person to sign in", async () => {
    user = null;
    expect((await call()).status).toBe(401);
  });
  it("is 404 when the database answered and the person cannot see such a note (a non-member)", async () => {
    loadNote.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("says it could not load, never an empty document, when a read fails", async () => {
    loadNote.mockRejectedValue(new Error("the data service did not answer"));
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/could not be loaded, so no document was made/);
    expect(res.headers.get("Content-Type")).not.toBe("application/pdf");
  });
  it("returns the PDF inline, private and not cached", async () => {
    loadNote.mockResolvedValue({ note: { note_no: "ENG-D-00017" } });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="ENG-D-00017.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(loadNote).toHaveBeenCalledWith(P, N);
  });
});
