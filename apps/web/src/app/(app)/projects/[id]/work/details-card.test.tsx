// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
vi.mock("@/components/os/collapsible", () => ({ OsCollapsible: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

import { ProjectDetailsCard } from "./details-card";

afterEach(cleanup);

// Fictional project and edition.
const details = { install_start: "2027-02-26", event_start: "2027-03-02", event_end: "2027-03-04", client_name: "Fictional Motors", location: "Expo Hall 4", site_timezone: "Asia/Dubai", scope: null, exclusions: null, technologies: [] };
const edition = { edition_id: "e1", event_id: "ev1", event_name: "Fictional Expo", label: "Fictional Expo · 2027 · Dubai", venue: "Expo Centre", city: "Dubai", start_date: "2027-03-01", end_date: "2027-03-05" };
const card = (over: Partial<Parameters<typeof ProjectDetailsCard>[0]> = {}) =>
  render(<ProjectDetailsCard pmName="Fictional Pia" acting={[]} team={[]} peopleCount={3} start="2027-02-01" end="2027-03-10" details={details} internal={false} feedbackOpen={0} feedbackHref="/x" {...over} />);

describe("the event edition on the project details card", () => {
  it("shows the label, venue and published show dates, apart from the project's own dates, with the note that it is a copy", () => {
    const { container } = card({ edition, editionLink: "/sales/events/ev1?edition=e1" });
    expect(screen.getByText("Event edition")).toBeTruthy();
    expect(screen.getByTestId("edition-label").textContent).toBe("Fictional Expo · 2027 · Dubai");
    expect(container.textContent).toContain("Venue: Expo Centre, Dubai");
    expect(container.textContent).toContain("Published show dates: 1 Mar 2027 to 5 Mar 2027");
    expect(container.textContent).toContain("These are the dates the organiser published when the handover was submitted. Later changes to the event in Sales do not change this project.");
    // the project's own delivery dates are still their own facts
    expect(container.textContent).toContain("2 Mar 2027 to 4 Mar 2027");
    expect(screen.getByRole("link", { name: "Open event in Sales" }).getAttribute("href")).toBe("/sales/events/ev1?edition=e1");
  });
  it("offers no link to someone who cannot read the edition in Sales, and says nothing about it", () => {
    const { container } = card({ edition, editionLink: "none" });
    expect(screen.queryByRole("link", { name: "Open event in Sales" })).toBeNull();
    expect(container.textContent).not.toMatch(/Could not check/);
  });
  it("when the check failed: no link, and it says the check could not be made (never 'no access')", () => {
    const { container } = card({ edition, editionLink: "error" });
    expect(screen.queryByRole("link", { name: "Open event in Sales" })).toBeNull();
    expect(container.textContent).toContain("Could not check whether you can open this event in Sales.");
    expect(container.textContent).not.toMatch(/no access|not allowed/i);
  });
  it("a project without an edition shows no edition block", () => {
    card();
    expect(screen.queryByText("Event edition")).toBeNull();
  });
});
