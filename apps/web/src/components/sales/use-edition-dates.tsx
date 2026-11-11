"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { chooseEdition, editionDatesNote, initialEditionDates, typeDate, applyEditionDates, type EditionDates } from "@/lib/crm/events/edition-dates";

/**
 * Event start and Event end for a form with an Event / Exhibition field (Quick Add, New enquiry, Edit details): choosing an edition fills the dates the person
 * has not set, both stay editable, and a manual date is kept (with the offer to use the edition's). Rules: lib/crm/events/edition-dates.ts.
 */
export function useEditionDates(o: { start?: string | null; end?: string | null; editionId?: string; editions: readonly { id: string; start?: string | null; end?: string | null }[] }) {
  const [state, setState] = useState(() => initialEditionDates(o.start, o.end, o.editionId ?? ""));
  const find = useCallback((id: string): EditionDates | null => { const e = o.editions.find((x) => x.id === id); return e ? { id: e.id, start: e.start ?? null, end: e.end ?? null } : null; }, [o.editions]);
  const edition = state.editionId ? find(state.editionId) : null;
  const note = editionDatesNote(state, edition);
  return {
    start: state.start.value, end: state.end.value, editionId: state.editionId,
    setStart: (v: string) => setState((s) => typeDate(s, "start", v)),
    setEnd: (v: string) => setState((s) => typeDate(s, "end", v)),
    /** Call when the Event / Exhibition field changes ("" = cleared). `known` supplies an edition that was only just created and may not be in the list yet. */
    setEdition: (id: string, known?: EditionDates) => setState((s) => chooseEdition(s, id ? (known ?? find(id) ?? { id, start: null, end: null }) : null)),
    /** The line under the dates; null when there is nothing to say. */
    note: note.hint ? (
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="status">
        <span>{note.hint}</span>
        {note.differs && edition ? <Button type="button" size="sm" variant="outline" onClick={() => setState((s) => applyEditionDates(s, edition))}>Use edition dates</Button> : null}
      </p>
    ) : null,
  };
}
