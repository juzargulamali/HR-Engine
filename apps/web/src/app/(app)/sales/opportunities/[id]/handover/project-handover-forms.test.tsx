/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/projectsCore", () => ({ saveHandover: vi.fn(), submitHandover: vi.fn(), withdrawHandover: vi.fn() }));

import { ProjectHandoverForm, type BriefValues } from "./project-handover-forms";

afterEach(() => cleanup());

const values = (over: Partial<BriefValues> = {}): BriefValues => ({
  title: "ADIPEC stand", clientName: "", location: "Riyadh Front", siteTimezone: "Asia/Riyadh", installStart: "", eventStart: "", eventEnd: "", scope: "", exclusions: "", notes: "", technologies: [], ...over,
});
const zone = () => screen.getByLabelText("Site time zone") as HTMLSelectElement;

describe("the site time zone on a handover brief", () => {
  it("opens on the suggested zone (not always Dubai), says why, and stays visible", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={null} existing={false} values={values({ siteTimezoneNote: "the enquiry's location mentions Riyadh" })} />);
    expect(zone().value).toBe("Asia/Riyadh");
    expect(screen.getByText(/Suggested because the enquiry's location mentions Riyadh\. Change it if the site is elsewhere/)).toBeTruthy();
  });

  it("can be changed to any offered zone, and the chosen zone is what the form sends", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={null} existing={false} values={values({ siteTimezoneNote: "the company is in Saudi Arabia" })} />);
    fireEvent.change(zone(), { target: { value: "Europe/Warsaw" } });
    expect(zone().value).toBe("Europe/Warsaw");
    expect(zone().getAttribute("name")).toBe("siteTimezone");
    expect(Array.from(zone().options).map((o) => o.value)).toContain("Asia/Dubai");
  });

  it("keeps the zone a saved brief was saved with and makes no suggestion", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={3} existing values={values({ siteTimezone: "Europe/Warsaw" })} />);
    expect(zone().value).toBe("Europe/Warsaw");
    expect(screen.queryByText(/Suggested because/)).toBeNull();
    expect(screen.getByText(/Change it if the site is elsewhere/)).toBeTruthy();
  });

  it("still offers a saved zone that is not in the common list", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={1} existing values={values({ siteTimezone: "Asia/Muscat" })} />);
    expect(zone().value).toBe("Asia/Muscat");
  });
});
