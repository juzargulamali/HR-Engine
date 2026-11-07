import { describe, expect, it } from "vitest";
import { effectiveRoles, hasRoleFor, offeredFor } from "./organisation-roles";

const org = (id: string, kind: string, roles?: string[]) => ({ id, kind, roles });
const both = org("both", "agency", ["agency", "client"]);
const agency = org("agency", "agency", ["agency"]);
const client = org("client", "client", ["client"]);
const direct = org("direct", "direct", ["direct"]);
const tech = org("tech", "client", ["technology"]);
const legacyClient = org("legacy-client", "client");           // roles not recorded: reads as its kind
const legacyAgency = org("legacy-agency", "agency", []);
const all = [both, agency, client, direct, tech, legacyClient, legacyAgency];

describe("which organisations each inquiry field offers", () => {
  it("one organisation with roles agency + client is offered in BOTH fields", () => {
    expect(offeredFor(all, "agency").map((o) => o.id)).toContain("both");
    expect(offeredFor(all, "client").map((o) => o.id)).toContain("both");
  });
  it("an organisation without the role is not offered", () => {
    expect(offeredFor(all, "agency").map((o) => o.id)).toEqual(["both", "agency", "legacy-agency"]);
    expect(offeredFor(all, "client").map((o) => o.id)).toEqual(["both", "client", "direct", "legacy-client"]);
    expect(hasRoleFor(tech, "agency") || hasRoleFor(tech, "client")).toBe(false);   // a technology company is neither
  });
  it("legacy records (no roles recorded) read as their kind", () => {
    expect(effectiveRoles(legacyClient)).toEqual(["client"]);
    expect(effectiveRoles(legacyAgency)).toEqual(["agency"]);
  });
  it("the one already selected stays listed so an older inquiry still shows what it has", () => {
    expect(offeredFor(all, "agency", "client").map((o) => o.id)).toContain("client");
    expect(offeredFor(all, "agency", "").map((o) => o.id)).not.toContain("client");
  });
});
