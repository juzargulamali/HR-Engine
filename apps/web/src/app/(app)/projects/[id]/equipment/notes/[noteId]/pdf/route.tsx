import { createElement } from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import { NoteDocument } from "@/lib/pdf/note-document";
import { loadNote } from "@/lib/inventory/project-notes-data";
import { notePdfFileName } from "@/lib/inventory/project-notes";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };
const notFound = () => new Response("Not found", { status: 404, headers });

/**
 * Downloads a dispatch note or return checklist as a PDF. The note is read with the caller's own session, so row-level security decides: a person who is not a
 * member of the project (or a founder of its company) and holds no warehouse / stock-reading right gets 404 exactly as if it did not exist. Nothing is stored: the
 * PDF is rendered from the note's frozen content each time (only the acknowledgement block and "status as of generation" change), and generating it sends nothing
 * to anyone. A read that FAILS is "could not load" (503), never an empty or partial document.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params;
  if (!UUID.test(id) || !UUID.test(noteId)) return notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download this file.", { status: 401, headers });

  let view: Awaited<ReturnType<typeof loadNote>>;
  try {
    view = await loadNote(id, noteId);
  } catch (e) {
    console.error("[inventory] note pdf: the note could not be read", e instanceof Error ? e.message : e);
    return new Response("The note could not be loaded, so no document was made. Try again in a moment.", { status: 503, headers: { ...headers, "Retry-After": "5" } });
  }
  if (!view) return notFound();

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(createElement(NoteDocument, { view, generatedAt: new Date() }) as Parameters<typeof renderToBuffer>[0]);
  } catch (e) {
    console.error("[inventory] note pdf: the document could not be made", e instanceof Error ? e.message : e);
    return new Response("The document could not be made. Try again in a moment.", { status: 500, headers });
  }
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${notePdfFileName(view.note.note_no)}"`,
      ...headers,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
