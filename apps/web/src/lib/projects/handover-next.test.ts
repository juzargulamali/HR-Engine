import { describe, expect, it } from "vitest";
import { handoverNext } from "./handover-next";

const names = { pm: "Pat Manager", sales: "Sam Sales", viewerId: "u-me" };
const h = (over: Partial<Parameters<typeof handoverNext>[0]> = {}) => ({ status: "submitted", pm_user_id: null, prepared_by: "u-s", project_id: null, ...over });

describe("handover owner and next step", () => {
  it("a submitted handover is with Operations, who assign the Project Manager", () => {
    expect(handoverNext(h(), names)).toMatchObject({ who: "Operations", next: "Assign a Project Manager", line: "With Operations (Operations) · Next: Assign a Project Manager" });
  });
  it("an assigned handover is with the named Project Manager, or 'you' for the viewer", () => {
    expect(handoverNext(h({ status: "pm_assigned", pm_user_id: "u-pm" }), names).line).toContain("With Pat Manager (Project Manager)");
    expect(handoverNext(h({ status: "pm_assigned", pm_user_id: "u-me" }), names).who).toBe("you");
  });
  it("a question sent back is with the Sales owner, who answers and resubmits", () => {
    expect(handoverNext(h({ status: "clarification_requested", pm_user_id: "u-pm" }), names)).toMatchObject({ who: "Sam Sales", next: "Answer Pat Manager's question and resubmit" });
  });
  it("after acceptance the next step is the live project's plan", () => {
    expect(handoverNext(h({ status: "accepted", pm_user_id: "u-pm", project_id: "p1" }), names).next).toContain("Bring in accepted technologies");
  });
});
