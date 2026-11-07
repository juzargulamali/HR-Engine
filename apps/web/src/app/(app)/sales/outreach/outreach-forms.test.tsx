/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/lib/actions/outreach", () => ({ linkOutreachInquiry: vi.fn(), logOutreachActivity: vi.fn(), setOutreachNextAction: vi.fn(), setOutreachStatus: vi.fn() }));

import { KindOutcomeFields } from "./outreach-forms";

afterEach(cleanup);
const options = () => Array.from((screen.getByLabelText("Outcome") as HTMLSelectElement).options).map((o) => o.textContent);

describe("Log activity: kind and outcome", () => {
  it("offers only the outcomes of the chosen kind", () => {
    render(<KindOutcomeFields id="t" />);
    expect(options()).toEqual(["Choose an outcome…", "No answer", "Left message", "Spoke", "Call back requested", "Not interested"]);
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "email" } });
    expect(options()).toEqual(["Choose an outcome…", "Sent", "Replied", "Bounced / wrong address", "Not interested"]);
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "meeting" } });
    expect(options()).toEqual(["Choose an outcome…", "Meeting booked", "Meeting held", "Rescheduled", "No show", "Not interested"]);
  });

  it("starts with no outcome chosen: nothing is defaulted, least of all a reply", () => {
    render(<KindOutcomeFields id="t" />);
    expect((screen.getByLabelText("Outcome") as HTMLSelectElement).value).toBe("");
  });

  it("changing the kind resets an outcome that does not fit and keeps one that does", () => {
    render(<KindOutcomeFields id="t" />);
    const outcome = () => (screen.getByLabelText("Outcome") as HTMLSelectElement).value;
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "spoke" } });
    expect(outcome()).toBe("spoke");
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "email" } });
    expect(outcome()).toBe("");          // Spoke is for calls only
    fireEvent.change(screen.getByLabelText("Outcome"), { target: { value: "not_interested" } });
    fireEvent.change(screen.getByLabelText("What"), { target: { value: "meeting" } });
    expect(outcome()).toBe("not_interested");   // fits every kind
  });
});
