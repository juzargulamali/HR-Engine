import { describe, expect, it } from "vitest";
import { config } from "./proxy";

// next.js anchors the matcher source as a path-to-regexp pattern; the one
// negative-lookahead pattern we use is also a valid RegExp once anchored.
const re = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it("still protects application routes", () => {
    for (const p of ["/", "/leave", "/people-access", "/approvals", "/os-previewer"]) expect(re.test(p)).toBe(true);
  });
  it("does not run the auth proxy for the design preview (it has no database or session)", () => {
    for (const p of ["/os-preview", "/os-preview/sales", "/os-preview/sales/opportunities/OPP-2026-0041"]) expect(re.test(p)).toBe(false);
  });
});
