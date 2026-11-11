/**
 * Event start / Event end of an enquiry, filled from the event edition it is linked to. PURE (the forms keep this state and call these functions), so every
 * rule is unit-tested. Dates are plain calendar days ("2027-03-30"): nothing here converts a time zone, so a date reads the same in the UAE, Saudi and Poland.
 *
 * Each field remembers where its value came from:
 *   "none"     empty and never set: the next edition chosen fills it;
 *   "edition"  filled from the chosen edition and not touched since: a different edition replaces it (or clears it, when that edition has no such date);
 *   "manual"   typed by the person (or already saved on the enquiry): never replaced, only by the explicit "Use edition dates";
 *   "cleared"  had a value (filled from an edition, typed, or saved on the enquiry) and was then emptied on purpose: stays empty.
 * Installation and dismantling dates are separate fields and are never touched here. Saved enquiry dates start as "manual": opening the edit form changes nothing,
 * and editing an edition later never reaches a saved enquiry.
 */
export type DateOrigin = "none" | "edition" | "manual" | "cleared";
export interface DateField { value: string; origin: DateOrigin }
export interface EditionDatesState { start: DateField; end: DateField; editionId: string }
export interface EditionDates { id: string; start: string | null; end: string | null }

const field = (value: string | null | undefined): DateField => (value ? { value, origin: "manual" } : { value: "", origin: "none" });

/** A form as it opens: dates already on the enquiry (or typed before) are the person's own. */
export const initialEditionDates = (start: string | null | undefined, end: string | null | undefined, editionId = ""): EditionDatesState => ({ start: field(start), end: field(end), editionId });

/** The person typed in (or emptied) a date field. */
export function typeDate(state: EditionDatesState, which: "start" | "end", value: string): EditionDatesState {
  const was = state[which];
  // Emptying a field that held a value is a decision (whether the value came from an edition or was typed): it stays empty until the person fills it or
  // chooses "Use edition dates". Only a field that never held anything is "none".
  const origin: DateOrigin = value ? "manual" : was.origin === "none" && !was.value ? "none" : "cleared";
  return { ...state, [which]: { value, origin } };
}

const apply = (f: DateField, date: string | null): DateField => {
  if (f.origin === "none" || f.origin === "edition") return date ? { value: date, origin: "edition" } : { value: "", origin: "none" };
  return f;   // manual and deliberately cleared fields are the person's
};

/**
 * An edition was chosen (or changed). `edition` null = the link was cleared: the dates stay exactly as they are. They keep their origin, because the search field
 * clears the choice while the person types the next edition's name: a date still inherited from the previous edition is replaced by the next one chosen, and a
 * date the person set is not.
 */
export function chooseEdition(state: EditionDatesState, edition: EditionDates | null): EditionDatesState {
  if (!edition) return { ...state, editionId: "" };
  return { start: apply(state.start, edition.start), end: apply(state.end, edition.end), editionId: edition.id };
}

/** The explicit "Use edition dates": both dates the edition has replace what is there. A date the edition does not have leaves that field alone. */
export function applyEditionDates(state: EditionDatesState, edition: EditionDates): EditionDatesState {
  return {
    start: edition.start ? { value: edition.start, origin: "edition" } : state.start,
    end: edition.end ? { value: edition.end, origin: "edition" } : state.end,
    editionId: edition.id,
  };
}

/** What the form says under the dates: that they came from the edition, or that they differ from it (with the offer to use the edition's). */
export function editionDatesNote(state: EditionDatesState, edition: EditionDates | null): { hint: string | null; differs: boolean } {
  if (!edition || state.editionId !== edition.id) return { hint: null, differs: false };
  const differs = (!!edition.start && state.start.value !== edition.start) || (!!edition.end && state.end.value !== edition.end);
  const inherited = state.start.origin === "edition" || state.end.origin === "edition";
  if (differs) return { hint: "These dates differ from the selected edition's.", differs: true };
  if (inherited) return { hint: "Dates filled from the selected edition. You can edit them: they belong to this enquiry.", differs: false };
  if (!edition.start && !edition.end) return { hint: "The selected edition has no dates recorded: enter them here.", differs: false };
  return { hint: null, differs: false };
}
