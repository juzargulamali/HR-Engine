/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClipboardCheck } from "lucide-react";
import { DecisionsCard } from "./decisions-card";

const ok = { key: "approvals", icon: ClipboardCheck, label: "Waiting on your decision", count: 3, href: "/approvals" };
const failed = { key: "approvals", icon: ClipboardCheck, label: "Approvals could not be loaded", count: 0, href: "/approvals", error: true };

describe("DecisionsCard", () => {
  it("a failed approvals read is an error row with a dash, never 'Nothing is waiting on you'", () => {
    const html = renderToStaticMarkup(<DecisionsCard decisions={[failed]} other={[]} />);
    expect(html).toContain("Approvals could not be loaded");
    expect(html).toContain("—");
    expect(html).not.toContain("Nothing is waiting on you");
  });
  it("shows the rows that loaded next to the failed one", () => {
    const html = renderToStaticMarkup(<DecisionsCard decisions={[failed]} other={[{ ...ok, key: "proj-soon", label: "Project task due in the next 7 days" }]} />);
    expect(html).toContain("Approvals could not be loaded");
    expect(html).toContain("Project task due in the next 7 days");
  });
  it("healthy: the count and the empty state are unchanged", () => {
    expect(renderToStaticMarkup(<DecisionsCard decisions={[ok]} other={[]} />)).toContain("Waiting on your decision");
    expect(renderToStaticMarkup(<DecisionsCard decisions={[]} other={[]} />)).toContain("Nothing is waiting on you");
  });
});
