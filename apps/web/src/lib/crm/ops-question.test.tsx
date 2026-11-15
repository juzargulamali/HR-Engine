/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/lib/actions/crmHandoverNotice", () => ({ dismissHandoverNotice: vi.fn() }));

import { OpsQuestionAttention } from "@/components/sales/ops-question-attention";
import { opsQuestionCandidates } from "@/lib/my-day/attention";
import { describeNotification } from "@/lib/projects/notification-text";
import { OPS_QUESTION_ANCHOR, opsQuestionHref, opsQuestionRows } from "./ops-question";

// Fictional enquiries.
const O1 = "11111111-1111-4111-8111-111111111111";
const O2 = "22222222-2222-4222-8222-222222222222";
const notice = (id: string, opp: string, at: string) => ({ id, payload: { opportunity_id: opp, reference: `REF-${opp.slice(0, 1)}`, dedupe_key: `ops_question:${opp}` }, created_at: at });
const known = new Map([[O1, { reference: "UAE-O-2027-0201", title: "Fictional Expo stand" }]]);

describe("the question notices as rows", () => {
  it("is one row per enquiry, oldest first, named from the enquiry when it can be read and from the notice when it cannot", () => {
    const rows = opsQuestionRows([notice("n2", O2, "2027-01-11T08:00:00Z"), notice("n1", O1, "2027-01-10T08:00:00Z")], known);
    expect(rows).toEqual([
      { noticeId: "n1", opportunityId: O1, reference: "UAE-O-2027-0201", title: "Fictional Expo stand", at: "2027-01-10T08:00:00Z" },
      { noticeId: "n2", opportunityId: O2, reference: "REF-2", title: null, at: "2027-01-11T08:00:00Z" },
    ]);
  });

  it("two unread notices about one enquiry are one row (the newest), and a notice without an enquiry is left out", () => {
    const rows = opsQuestionRows([notice("old", O1, "2027-01-10T08:00:00Z"), notice("new", O1, "2027-01-12T08:00:00Z"), { id: "x", payload: {}, created_at: "2027-01-12T08:00:00Z" }], known);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ noticeId: "new" });
  });

  it("links to the question itself: the Overview tab, at the question", () => {
    expect(opsQuestionHref(O1)).toBe(`/sales/opportunities/${O1}?tab=overview#${OPS_QUESTION_ANCHOR}`);
    expect(describeNotification("project_ops_question", { opportunity_id: O1, reference: "UAE-O-2027-0201" })).toEqual({ text: "Operations asked a question on UAE-O-2027-0201", href: opsQuestionHref(O1) });
    expect(describeNotification("project_ops_question", {})).toEqual({ text: "Operations asked a question on an enquiry", href: null });
  });
});

describe("where Sales sees it", () => {
  const rows = opsQuestionRows([notice("n1", O1, "2027-01-10T08:00:00Z")], known);

  it("Follow-ups lists the enquiry with a link to the question and a Dismiss for the person's own notice", () => {
    const html = renderToStaticMarkup(<OpsQuestionAttention check={{ status: "ok", rows }} />);
    expect(html).toContain("Questions from Operations");
    expect(html).toContain(`href="${opsQuestionHref(O1).replace("&", "&amp;")}"`);
    expect(html).toContain("Fictional Expo stand");
    expect(html).toContain("Dismiss the question from Operations for Fictional Expo stand");
    expect(html).not.toContain("—");
  });

  it("nothing to show is nothing; a failed read says so and is never 'no questions'", () => {
    expect(renderToStaticMarkup(<OpsQuestionAttention check={{ status: "ok", rows: [] }} />)).toBe("");
    expect(renderToStaticMarkup(<OpsQuestionAttention check={{ status: "none" }} />)).toBe("");
    expect(renderToStaticMarkup(<OpsQuestionAttention check={{ status: "error" }} />)).toMatch(/Could not check whether Operations has asked you a question/);
  });

  it("My Day lists it once per enquiry, under the enquiry's own key, opening the question", () => {
    const c = opsQuestionCandidates({ status: "ok", rows }, new Date("2027-01-13T08:00:00Z"));
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ key: `opp:${O1}`, source: "sales-ops-question", title: "Fictional Expo stand", context: "UAE-O-2027-0201", what: "Operations asked a question", href: opsQuestionHref(O1), tier: 2 });
    expect(c[0]!.when).toMatch(/3 days/);
  });
});
