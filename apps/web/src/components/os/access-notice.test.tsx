/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let session: { loadFailed?: boolean } | null = {};
vi.mock("@/lib/auth/session", () => ({ getCurrentSession: async () => session }));

import { AccessNotice } from "./access-notice";

const render = async () => renderToStaticMarkup(await AccessNotice({ title: "Alerts", children: "Alerts are restricted to HR Admin, CEO, and CTO." }));

beforeEach(() => { session = {}; });

describe("AccessNotice", () => {
  it("says who may open the page when the roles were read", async () => {
    const html = await render();
    expect(html).toContain("restricted to HR Admin");
  });
  it("says it could not load, not 'restricted', when the roles could not be read", async () => {
    session = { loadFailed: true };
    const html = await render();
    expect(html).toContain("Could not load your access");
    expect(html).not.toContain("restricted to HR Admin");
  });
});
