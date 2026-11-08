import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { estimateWording } from "./wording";

describe("estimate wording of database messages", () => {
  it("every refusal the quotation functions can raise reads as Estimate: no quotation, issue(d/ing), validity or founder's approval", () => {
    const sql = readFileSync(path.join(__dirname, "../../../../../../supabase/migrations/20261220000100_crm_estimates_quotations.sql"), "utf8");
    const start = sql.indexOf("create or replace function crm_quote_load_editable");
    const body = sql.slice(start, sql.indexOf("revoke all on function", start));
    const messages = [...body.matchAll(/raise exception '((?:[^']|'')*)'/g)].map((m) => m[1]!.replace(/''/g, "'"));
    expect(messages.length).toBeGreaterThan(40);
    for (const m of messages) {
      const out = estimateWording(m);
      expect(out, m).not.toMatch(/quotation/i);
      expect(out, m).not.toMatch(/\bissu(e|ed|ing)\b/i);
      expect(out, m).not.toMatch(/validity date/i);
      expect(out, m).not.toMatch(/founder's approval/i);
      expect(estimateWording(out)).toBe(out);   // idempotent
    }
  });
  it("reads naturally for the common ones", () => {
    expect(estimateWording("Choose the currency before issuing")).toBe("Choose the currency before finalising");
    expect(estimateWording("Choose who the quotation is billed to before issuing")).toBe("Choose who the estimate is addressed to before finalising");
    expect(estimateWording("The validity date is in the past")).toBe("The review-pricing date is in the past");
    expect(estimateWording("There is already an unissued revision of this quotation")).toBe("There is already an unfinalised revision of this estimate");
    expect(estimateWording("This quotation needs a founder's approval of this exact version (it changed since the last approval, or none was requested from this page). Request approval first")).toMatch(/^This estimate needs approval of this exact version/);
    expect(estimateWording("Only an issued quotation needs a revision. Edit the draft instead")).toBe("Only a finalised estimate needs a revision. Edit the draft instead");
    expect(estimateWording("An issued quotation cannot be edited. Create a revision instead.")).toBe("A finalised estimate cannot be edited. Create a revision instead.");
    expect(estimateWording("Field vat_x cannot be changed here")).toBe("Field vat_x cannot be changed here");
  });
});
