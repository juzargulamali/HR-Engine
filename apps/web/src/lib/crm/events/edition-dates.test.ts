import { describe, expect, it } from "vitest";
import { applyEditionDates, chooseEdition, editionDatesNote, initialEditionDates, typeDate, type EditionDates } from "./edition-dates";

const A: EditionDates = { id: "a", start: "2027-03-30", end: "2027-04-02" };
const B: EditionDates = { id: "b", start: "2028-03-28", end: "2028-03-31" };
const START_ONLY: EditionDates = { id: "s", start: "2029-01-10", end: null };
const NONE: EditionDates = { id: "n", start: null, end: null };
const dates = (s: { start: { value: string }; end: { value: string } }) => [s.start.value, s.end.value];

describe("enquiry dates filled from an event edition", () => {
  it("fills both empty dates from the edition; both remain the enquiry's own editable values", () => {
    const s = chooseEdition(initialEditionDates(null, null), A);
    expect(dates(s)).toEqual(["2027-03-30", "2027-04-02"]);
    expect(editionDatesNote(s, A)).toEqual({ hint: "Dates filled from the selected edition. You can edit them: they belong to this enquiry.", differs: false });
  });
  it("copies the one date an edition has, and leaves the fields for entry when it has none", () => {
    expect(dates(chooseEdition(initialEditionDates(null, null), START_ONLY))).toEqual(["2029-01-10", ""]);
    const none = chooseEdition(initialEditionDates(null, null), NONE);
    expect(dates(none)).toEqual(["", ""]);
    expect(editionDatesNote(none, NONE).hint).toMatch(/no dates recorded: enter them here/);
  });
  it("keeps dates typed before the edition was chosen and offers the edition's dates as an explicit choice", () => {
    const typed = typeDate(initialEditionDates(null, null), "start", "2027-03-29");
    const s = chooseEdition(typed, A);
    expect(dates(s)).toEqual(["2027-03-29", "2027-04-02"]);
    expect(editionDatesNote(s, A)).toEqual({ hint: "These dates differ from the selected edition's.", differs: true });
    expect(dates(applyEditionDates(s, A))).toEqual(["2027-03-30", "2027-04-02"]);
  });
  it("switching editions replaces what was inherited and keeps each manually overridden field", () => {
    let s = chooseEdition(initialEditionDates(null, null), A);
    s = typeDate(s, "end", "2027-04-03");                       // override the end only
    s = chooseEdition(s, B);
    expect(dates(s)).toEqual(["2028-03-28", "2027-04-03"]);
    expect(editionDatesNote(s, B).differs).toBe(true);
  });
  it("clears an inherited date when the new edition lacks it, and respects a field the person deliberately cleared", () => {
    let s = chooseEdition(initialEditionDates(null, null), A);
    s = chooseEdition(s, START_ONLY);
    expect(dates(s)).toEqual(["2029-01-10", ""]);               // the inherited end is cleared: the new edition has none
    s = chooseEdition(initialEditionDates(null, null), A);
    s = typeDate(s, "start", "");                               // deliberately emptied after it was filled
    s = chooseEdition(s, B);
    expect(dates(s)).toEqual(["", "2028-03-31"]);               // stays empty; the untouched end follows the edition
    expect(dates(applyEditionDates(s, B))).toEqual(["2028-03-28", "2028-03-31"]);   // only the explicit choice fills it again
  });
  it("unlinking keeps the dates; the next edition chosen replaces what was still inherited (the field clears the choice while a new name is typed) and keeps what was typed", () => {
    let s = chooseEdition(initialEditionDates(null, null), A);
    s = typeDate(s, "end", "2027-04-03");
    s = chooseEdition(s, null);
    expect(dates(s)).toEqual(["2027-03-30", "2027-04-03"]);
    expect(s.editionId).toBe("");
    expect(editionDatesNote(s, null)).toEqual({ hint: null, differs: false });
    expect(dates(chooseEdition(s, B))).toEqual(["2028-03-28", "2027-04-03"]);
  });
  it("saved enquiry dates are never overwritten when the edit form opens, nor by choosing another edition; an empty saved date is filled", () => {
    const opened = initialEditionDates("2027-03-29", "2027-04-05", "a");
    expect(dates(opened)).toEqual(["2027-03-29", "2027-04-05"]);
    expect(editionDatesNote(opened, A).differs).toBe(true);     // it says they differ; it changes nothing
    expect(dates(chooseEdition(opened, B))).toEqual(["2027-03-29", "2027-04-05"]);
    expect(dates(chooseEdition(initialEditionDates("2027-03-29", null, "a"), B))).toEqual(["2027-03-29", "2028-03-31"]);
  });
  it("dates are plain calendar days: nothing is shifted by a time zone", () => {
    const s = chooseEdition(initialEditionDates(null, null), { id: "z", start: "2027-01-01", end: "2027-12-31" });
    expect(dates(s)).toEqual(["2027-01-01", "2027-12-31"]);
  });
});
