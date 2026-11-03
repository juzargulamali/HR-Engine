/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClipboardCheck } from "lucide-react";
import { ATTENTION_LIST_ID, buildAttention, failed, ok, type AttentionCandidate } from "@/lib/my-day/attention";
import { AttentionLine } from "./attention-line";
import { DecisionsCard } from "./decisions-card";

const cand = (over: Partial<AttentionCandidate> & { key: string }): AttentionCandidate => ({ source: "approvals", icon: ClipboardCheck, title: "Leave request: Aisha Khan", what: "Waiting for your decision", tier: 2, at: null, href: "/approvals", ...over });
const rows = (...c: AttentionCandidate[]) => buildAttention([ok("approvals", c)]);

describe("DecisionsCard (the attention list)", () => {
  it("is the target of the headline's link, and the headline is made from the same attention", () => {
    const a = rows(cand({ key: "a" }), cand({ key: "b", title: "Timesheet" }));
    const headline = renderToStaticMarkup(<AttentionLine headline={a.headline} />);
    expect(headline).toContain(`href="#${ATTENTION_LIST_ID}"`);
    expect(headline).toContain("2 items need your attention");
    const html = renderToStaticMarkup(<DecisionsCard attention={a} />);
    expect(html).toContain(`id="${ATTENTION_LIST_ID}"`);
    // as many list entries as the headline says
    expect(html.match(/data-attention-key=/g)).toHaveLength(a.count);
    expect(html).toContain(">Needs me<");
  });
  it("each row names the record, what to do, the project or person, how late, and links to where it is handled", () => {
    const html = renderToStaticMarkup(<DecisionsCard attention={rows(cand({ key: "task:1", title: "Install LED wall", what: "Task overdue", context: "P-1 · Expo", when: "Overdue since 28 Oct", tier: 0, href: "/projects/work?task=1" }))} />);
    for (const text of ["Install LED wall", "Task overdue", "P-1 · Expo", "Overdue since 28 Oct"]) expect(html).toContain(text);
    expect(html).toContain('href="/projects/work?task=1"');
  });
  it("a merged record shows what else was asked of it", () => {
    const a = buildAttention([ok("project-tasks", [cand({ key: "task:1", what: "Task overdue", tier: 0, at: "2026-10-28" }), cand({ key: "task:1", what: "Task waiting for your review" })])]);
    expect(renderToStaticMarkup(<DecisionsCard attention={a} />)).toContain("Also: Task waiting for your review");
  });
  it("a failed source is an error row with a dash next to the rows that loaded, and never 'nothing'", () => {
    const a = buildAttention([ok("project-tasks", [cand({ key: "t", title: "Install LED wall" })]), failed("approvals")]);
    const html = renderToStaticMarkup(<DecisionsCard attention={a} />);
    expect(html).toContain("Approvals could not be loaded");
    expect(html).toContain("—");
    expect(html).toContain("Install LED wall");
    expect(html).toContain("1 part could not be loaded: Approvals");
    expect(html).not.toMatch(/Nothing needs your attention/);
  });
  it("only failures: no empty-state message", () => {
    const html = renderToStaticMarkup(<DecisionsCard attention={buildAttention([failed("approvals")])} />);
    expect(html).toContain("Approvals could not be loaded");
    expect(html).not.toMatch(/Nothing needs your attention|show up here/);
  });
  it("all loaded and nothing to do: says so", () => {
    const html = renderToStaticMarkup(<DecisionsCard attention={buildAttention([ok("approvals", [])])} />);
    expect(html).toContain("Nothing needs your attention right now.");
    expect(html).toContain(`id="${ATTENTION_LIST_ID}"`);
  });
  it("'Waiting on others' is a separate group below, and 'Also open' is information that is not counted", () => {
    const mine = { key: "budget-waiting", icon: ClipboardCheck, label: "Project budgets you submitted, waiting on others", count: 2, href: "/finance/project-budgets" };
    const quiet = { key: "proj-unread", icon: ClipboardCheck, label: "Unread project discussion messages", count: 4, href: "/projects" };
    const a = rows(cand({ key: "a" }));
    const html = renderToStaticMarkup(<DecisionsCard attention={a} other={[quiet]} waiting={[mine]} />);
    expect(html.match(/data-attention-key=/g)).toHaveLength(1);
    expect(html.indexOf("Also open")).toBeLessThan(html.indexOf("Waiting on others"));
    expect(html.indexOf("Waiting on others")).toBeLessThan(html.indexOf("Project budgets you submitted"));
    // with nothing to do, the waiting group is still visible
    const only = renderToStaticMarkup(<DecisionsCard attention={buildAttention([ok("approvals", [])])} waiting={[mine]} />);
    expect(only).toContain("Nothing needs your attention right now.");
    expect(only).toContain("Waiting on others");
  });
  it("a waiting row can say how long it has waited, and a failed waiting source is its own error row", () => {
    const aged = { key: "waiting-leave", icon: ClipboardCheck, label: "Leave request you submitted, waiting for a decision", count: 1, href: "/leave", detail: "Oldest waiting 3 days" };
    const bad = { key: "waiting-claims", icon: ClipboardCheck, label: "Your expense claims could not be loaded", count: 0, href: "/reimbursements", error: true };
    const html = renderToStaticMarkup(<DecisionsCard attention={rows(cand({ key: "a" }))} waiting={[aged, bad]} />);
    expect(html).toContain("Oldest waiting 3 days");
    expect(html).toContain("Your expense claims could not be loaded");
  });
});
