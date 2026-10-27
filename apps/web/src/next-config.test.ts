import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// The four scattered "who has access" screens moved into People & Access. A bookmark or an old link must keep working.
describe("old management addresses", () => {
  it("redirect, temporarily, to People & Access", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const map = new Map(redirects.map((r) => [r.source, r]));
    for (const source of ["/admin/users", "/sales/access", "/projects/access", "/inventory/access"]) {
      const r = map.get(source);
      expect(r, source).toBeTruthy();
      expect(r!.destination).toBe("/people-access");
      expect("permanent" in r! ? r!.permanent : undefined).toBe(false);
    }
  });

  it("redirect nothing else", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects.map((r) => r.source).sort()).toEqual(["/admin/users", "/inventory/access", "/projects/access", "/sales/access"]);
  });
});
