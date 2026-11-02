/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let check: { status: string; handoverStatus?: string | null } = { status: "ok", handoverStatus: null };
vi.mock("@/lib/crm/handover-attention-data", () => ({ loadHandoverStatus: async () => check }));

import { WonHandoverPrompt } from "./won-handover-prompt";

const render = async () => renderToStaticMarkup(await WonHandoverPrompt({ opportunityId: "o1" }));
beforeEach(() => { check = { status: "ok", handoverStatus: null }; });

describe("WonHandoverPrompt (after Confirm as won)", () => {
  it("not started or still a draft: 'Prepare the handover now' to the enquiry's handover page", async () => {
    for (const handoverStatus of [null, "draft"]) {
      check = { status: "ok", handoverStatus };
      const html = await render();
      expect(html).toContain("Prepare the handover now");
      expect(html).toContain('href="/sales/opportunities/o1/handover"');
    }
  });
  it("after submission it says where it stands and no longer prompts to prepare", async () => {
    check = { status: "ok", handoverStatus: "submitted" };
    let html = await render();
    expect(html).toContain("Handover submitted");
    expect(html).not.toContain("Prepare the handover now");
    check = { status: "ok", handoverStatus: "accepted" };
    html = await render();
    expect(html).toContain("Handover accepted");
  });
  it("the PM's question is offered as 'Answer it'", async () => {
    check = { status: "ok", handoverStatus: "clarification_requested" };
    expect(await render()).toContain("Answer it");
  });
  it("a failed read says it could not check", async () => {
    check = { status: "error" };
    const html = await render();
    expect(html).toContain("Could not check the handover");
    expect(html).not.toContain("Prepare the handover now");
  });
  it("Projects not installed: the plain link to the handover package", async () => {
    check = { status: "none" };
    expect(await render()).toContain("Open the handover package");
  });
});
