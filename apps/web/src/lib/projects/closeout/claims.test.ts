import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import cases from "./claim-cases.json";
import { CLAIM_PATTERNS } from "./claims";
import { evidenceItems, buildOutbound } from "./evidence";
import { fixtureSnapshot, ID } from "./fixture";
import { blocksFor, blockingFlags, factsOnlyDraft, keyFacts, recordedWordsOf, toSourceRefs, validateEdits } from "./report";

const s = fixtureSnapshot();                                   // a client project, no completion record, 3 units still out
const words = recordedWordsOf(s);
const signed = fixtureSnapshot({ completion: { id: ID.completion, completed_at: "2027-03-06T12:00:00+00:00", completed_by: "Pat Manager", evidence_type: "signed_handover", confirmed_on: "2027-03-06", has_reference: true, has_file: false, resolutions: [], note_text: null } });

describe("closeout narrative checks: the same rules in the app and in the database", () => {
  it("marks every shared case exactly as written down (the database test runs the same file)", () => {
    expect(cases.cases.length).toBeGreaterThan(40);
    for (const c of cases.cases) expect(blocksFor(c.text, s, words), c.text).toEqual(c.blocks);
  });

  it("the patterns installed in the database are these patterns, character for character", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../../../../supabase/migrations/20270101000100_proj_closeout_reports.sql"), "utf8");
    for (const [name, source] of Object.entries(CLAIM_PATTERNS)) {
      const line = new RegExp(`^  c_${name} constant text := '(.*)';$`, "m").exec(sql);
      expect(line, name).not.toBeNull();
      expect(line![1], name).toBe(source.replace(/\\b/g, "\\y").replace(/'/g, "''"));
      expect(source, name).not.toMatch(/\(\?<[=!]/);            // no lookbehind: the database's dialect does not have it
    }
  });

  it("indirect wording that implies a sign-off or a completion the records do not hold is blocked", () => {
    for (const t of [
      "We got the green light on the last day.", "The stand opened with the client's blessing.", "Fictional Motors were delighted with the final result.", "The client was satisfied with the installation.",
      "The client agreed that the work was complete.", "The client had no further objections.", "The client confirmed the handover on the last day.", "The stand was formally accepted on site.",
      "The agency approved everything before doors opened.", "The customer gave the go-ahead to close.", "Everything was officially handed over.", "The client is happy with the finished stand.",
    ]) expect(blocksFor(t, s, words), t).toContain("signoff_unrecorded");
    for (const t of ["The project was completed on time.", "The project has been successfully closed out.", "After the event we completed the project.", "This marked the successful completion of the work.", "The event brought the project to a close.", "Project closed on 6 March.", "The team wrapped up the project the next morning."]) expect(blocksFor(t, s, words), t).toContain("completion_unrecorded");
    // what the records DO support is not blocked: work that is recorded as done, and plain statements that something is not recorded
    for (const t of ["The content task was completed on 2027-02-27.", "The Design approved milestone was accepted by Pat Manager.", "Completion is not recorded.", "Client sign-off is not recorded.", "The project is in progress and has not been completed.", "Installation finished ahead of the event.", "The client raised one correction, which was resolved on site."]) expect(blocksFor(t, s, words), t).toEqual([]);
  });

  it("the same sentences are fine once the record exists, and an internal note is still not a client sign-off", () => {
    const back = { ...signed, equipment: { requests: [{ ...s.equipment!.requests[0]!, lines: [{ ...s.equipment!.requests[0]!.lines[0]!, returned: 4 }] }] } };
    for (const t of ["The client signed off the installation.", "The project was completed on time.", "Everything is back in the warehouse.", "Fictional Motors were delighted with the final result."]) expect(blocksFor(t, back, recordedWordsOf(back)), t).toEqual([]);
    const note = { ...signed, completion: { ...signed.completion!, evidence_type: "internal_note" } };
    expect(blocksFor("The client signed off.", note, recordedWordsOf(note))).toEqual(["signoff_unrecorded"]);
    expect(blocksFor("The project was completed on time.", note, recordedWordsOf(note))).toEqual([]);        // completion IS recorded; the sign-off is not
    expect(blocksFor("The equipment is all back.", signed, recordedWordsOf(signed))).toEqual(["equipment_out"]); // completed, and equipment still out: separate facts
  });

  it("a block does not depend on the marks or sources a caller sends: only the text and the snapshot", () => {
    const sent = buildOutbound(evidenceItems(s), null).sent;
    const forged = [{ id: "handover", paragraphs: [{ text: "The client signed off and the project was completed.", refs: [sent[0]!.ref], flags: [] }] }];
    const checked = validateEdits(forged, toSourceRefs(sent), s, factsOnlyDraft(sent))!;
    expect(blockingFlags(checked).sort()).toEqual(["completion_unrecorded", "signoff_unrecorded"]);
    // a quotation must be in the project's records, not merely in a source line the caller supplied
    const fake = [...toSourceRefs(sent), { ref: "S900", category: "feedback" as const, label: "x", source_type: "feedback", source_id: null, text: 'The client said "a triumph".' }];
    expect(blockingFlags(validateEdits([{ id: "feedback", paragraphs: [{ text: 'The client called it "a triumph".', refs: ["S900"], flags: [] }] }], fake, s, [])!)).toEqual(["unverified_quote"]);
  });

  it("the Recorded facts come from the snapshot alone, whatever the narrative says", () => {
    const facts = keyFacts(s);
    expect(facts.find((f) => f.label === "Completion")).toMatchObject({ value: "Not recorded", attention: true });
    expect(facts.find((f) => f.label === "Client sign-off")).toMatchObject({ value: "Not recorded", attention: true });
    expect(facts.find((f) => f.label === "Equipment")).toMatchObject({ value: "3 units still out, due back 2027-03-08", attention: true });
    expect(keyFacts.length).toBe(1);                              // one argument: the snapshot. There is no way to pass a narrative in
    const done = keyFacts(signed);
    expect(done.find((f) => f.label === "Client sign-off")!.value).toBe("Recorded, confirmed 2027-03-06");
    expect(done.find((f) => f.label === "Equipment")!.value).toMatch(/3 units still out/);                    // delivery complete and equipment returned stay separate
    expect(keyFacts({ ...signed, completion: { ...signed.completion!, evidence_type: "internal_note" } }).find((f) => f.label === "Client sign-off")!.value).toBe("Not recorded (the project was completed on an internal note)");
  });

  it("known limits, written down: wording these word patterns do not catch", () => {
    for (const t of ["We left on very good terms.", "Nothing further is expected from our side.", "They shook hands and thanked the crew.", "Doors opened on schedule and the stand ran all week."]) expect(blocksFor(t, s, words), t).toEqual([]);
  });
});
