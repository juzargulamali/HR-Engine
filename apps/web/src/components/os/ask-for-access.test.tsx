/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { failing, fakeSupabase, rows, type FakeResult } from "@/test/fake-supabase";

vi.mock("server-only", () => ({}));
let result: FakeResult = rows([]);
let asked: unknown[] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const base = fakeSupabase({}, { module_access_managers: () => result });
    return { ...base, rpc: (name: string, args: unknown) => { asked.push([name, args]); return base.rpc(name); } };
  },
}));

import { AskForAccess } from "./ask-for-access";
import { joinNames } from "@/lib/access/managers";

const render = async (props: Parameters<typeof AskForAccess>[0]) => renderToStaticMarkup(await AskForAccess(props));
beforeEach(() => { result = rows([]); asked = []; });

describe("AskForAccess (U-13)", () => {
  it("names the people who can grant access, in the person's own company, and asks for the module only", async () => {
    result = rows([{ user_id: "u1", display_name: "Sara Lead" }, { user_id: "u2", display_name: "Sam Manager" }]);
    const html = await render({ module: "sales", to: "give you access" });
    expect(html).toContain("Ask Sara Lead or Sam Manager to give you access.");
    expect(asked).toEqual([["module_access_managers", { p_module: "sales" }]]);
  });
  it("nobody listed: the generic wording stays", async () => {
    expect(await render({ module: "projects" })).toContain("Ask a founder to give you access.");
    expect(await render({ module: "inventory", generic: "an Inventory founder" })).toContain("Ask an Inventory founder to give you access.");
  });
  it("a failed read says it could not load who can grant access: never blank, never 'nobody'", async () => {
    result = failing();
    const html = await render({ module: "sales" });
    expect(html).toContain("Could not load who can grant access.");
    expect(html).not.toMatch(/Ask a founder|nobody/i);
  });
  it("a long list is cut so a denial stays short", () => {
    expect(joinNames(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C, D or 2 more");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames([])).toBe("");
  });
});
