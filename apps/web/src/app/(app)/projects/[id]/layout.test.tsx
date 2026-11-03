/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  useRouter: () => ({ push: vi.fn() }), usePathname: () => "/projects/p1", redirect: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: async () => ({ data: [] }) }) }));
vi.mock("@/lib/projects/context", () => ({ getProjectsContext: async () => ({ userId: "u1", grants: [] }) }));
vi.mock("@/lib/budget/data", () => ({ loadProjectBudgetAccess: async () => ({ can_open: false }) }));
vi.mock("@/components/workspace/list-memory", () => ({ BackLink: () => <span>All projects</span> }));
vi.mock("@/components/projects/manage-menu", () => ({ ManageMenu: () => null }));
vi.mock("@/components/projects/project-tabs", () => ({ ProjectTabs: () => <nav>tabs</nav> }));
let view: unknown;
let failure: Error | null = null;
vi.mock("@/lib/projects/data", () => ({ loadProjectView: async () => { if (failure) throw failure; return view; } }));

import ProjectLayout from "./layout";

const render = async () => renderToStaticMarkup(await ProjectLayout({ children: <p>child page</p>, params: Promise.resolve({ id: "p1" }) }));

beforeEach(() => { failure = null; view = null; });

describe("Project layout", () => {
  it("a failed read says it could not load; it is not a 404 and shows no project page", async () => {
    failure = new Error("Project could not be loaded: down");
    const html = await render();
    expect(html).toContain("Could not load this project");
    expect(html).toContain("Try again");
    expect(html).not.toContain("child page");
  });
  it("a project that is absent or not visible is still 'not found'", async () => {
    view = null;
    await expect(render()).rejects.toThrow("NOT_FOUND");
  });
});
