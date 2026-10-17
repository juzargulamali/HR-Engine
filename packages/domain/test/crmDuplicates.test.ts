import { describe, expect, it } from "vitest";
import { findLikelyDuplicates, organisationNameKey, scoreDuplicate, type DuplicateCandidate } from "../src";

const base: DuplicateCandidate = {
  id: "1", reference: "OPP-UAE-2026-0001", stage: "qualified",
  agencyOrgId: "zeta", clientOrgId: "orbit", title: "Interactive floor projection showroom launch",
  eventStart: "2026-11-24", installStart: "2026-11-20", location: "Dubai Mall", technologies: [{ name: "Floor projection", qty: 2 }],
};

describe("duplicate detection", () => {
  it("never flags enquiries that merely share an agency and a client", () => {
    const another = { agencyOrgId: "zeta", clientOrgId: "orbit", title: "Museum augmented reality guide", eventStart: "2027-03-02", location: "Abu Dhabi", technologies: [{ name: "AR", qty: 1 }] };
    expect(scoreDuplicate(another, base).score).toBeLessThan(40);
    expect(findLikelyDuplicates(another, [base])).toEqual([]);
  });
  it("does not flag the same agency alone, however many briefs it sends", () => {
    expect(findLikelyDuplicates({ agencyOrgId: "zeta" }, [base])).toEqual([]);
  });
  it("flags the same brief re-entered (similar title, same dates, place and technology)", () => {
    const again = { agencyOrgId: "zeta", clientOrgId: "orbit", title: "Floor projection for the showroom launch", eventStart: "2026-11-24", location: "Dubai Mall", technologies: [{ name: "floor projection", qty: 1 }] };
    const [m] = findLikelyDuplicates(again, [base]);
    expect(m?.level).toBe("likely");
    expect(m?.reasons).toEqual(expect.arrayContaining(["Same event date", "Same location", "Same technologies"]));
  });
  it("flags a re-entry through a different agency (same end client, dates, place)", () => {
    const m = findLikelyDuplicates({ agencyOrgId: "other", clientOrgId: "orbit", title: "Showroom launch floor projection", eventStart: "2026-11-25", location: "dubai mall" }, [base]);
    expect(m).toHaveLength(1);
  });
  it("ranks the strongest candidate first", () => {
    const weaker = { ...base, id: "2", title: "Showroom wall", eventStart: "2026-12-05", technologies: [] };
    const subject = { agencyOrgId: "zeta", clientOrgId: "orbit", title: "Floor projection showroom launch", eventStart: "2026-11-24", location: "Dubai Mall", technologies: [{ name: "Floor projection", qty: 1 }] };
    const out = findLikelyDuplicates(subject, [weaker, base]);
    expect(out[0]?.candidate.id).toBe("1");
  });
  it("normalises organisation names like the database does", () => {
    expect(organisationNameKey("Zeta Media L.L.C.")).toBe(organisationNameKey("ZETA MEDIA LLC"));
  });
  it("copes with missing information", () => {
    expect(scoreDuplicate({}, base).score).toBe(0);
    expect(findLikelyDuplicates({}, [{ ...base, eventStart: null, technologies: null, location: null }])).toEqual([]);
  });
});
