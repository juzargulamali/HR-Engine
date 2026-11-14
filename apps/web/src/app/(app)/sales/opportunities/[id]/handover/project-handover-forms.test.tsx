/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/projectsCore", () => ({ saveHandover: vi.fn(), saveAndSubmitHandover: vi.fn(), submitHandover: vi.fn(), withdrawHandover: vi.fn() }));

import { ProjectHandoverForm, WithdrawProjectHandoverForm, type BriefValues } from "./project-handover-forms";

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

describe("Save and submit in one step", () => {
  it("is offered for a first or answered brief, with Save draft beside it and the risks editable", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={null} existing={false} submitMode="submit" values={values({ risks: ["Venue power unconfirmed", "Tight load-in"] })} />);
    expect(screen.getByRole("button", { name: "Save and submit" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).value).toBe("draft");
    expect((screen.getByLabelText("Risks") as HTMLTextAreaElement).value).toBe("Venue power unconfirmed\nTight load-in");
  });
  it("says resubmit after the Project Manager asked a question", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={2} existing submitMode="resubmit" values={values()} />);
    expect(screen.getByRole("button", { name: "Save and resubmit to the Project Manager" })).toBeTruthy();
  });
  it("only saves once it is already submitted (no submit button, no Save draft)", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={2} existing values={values()} />);
    expect(screen.getByRole("button", { name: "Save changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});

describe("the brief form follows the brief, and says what its buttons do", () => {
  it("asks for the fields in the order the Project Manager reads them: scope, site and dates, equipment, risks, notes", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={null} existing={false} submitMode="submit" values={values()} />);
    const ids = Array.from(document.querySelectorAll("input[id], textarea[id], select[id]")).map((e) => e.id);
    expect(ids).toEqual(["ph-title", "ph-scope", "ph-excl", "ph-client", "ph-location", "ph-install", "ph-estart", "ph-eend", "ph-tz", "ph-risks", "ph-notes"]);
    expect(screen.getByText("Required before you can submit.")).toBeTruthy();
  });
  it("says who is told on submit and on resubmit, and that nothing goes to the client", () => {
    render(<ProjectHandoverForm opportunityId="o1" version={null} existing={false} submitMode="submit" values={values()} />);
    expect(screen.getByTestId("handover-submit-tells").textContent).toMatch(/^When you submit: Founders, Operations Managers and anyone who can assign Project Managers.*Nothing is sent to the client\..*still saved as a draft\.$/);
    cleanup();
    render(<ProjectHandoverForm opportunityId="o1" version={2} existing submitMode="resubmit" values={values()} />);
    expect(screen.getByTestId("handover-submit-tells").textContent).toMatch(/^When you resubmit: The Project Manager gets a notification in the app/);
    // One primary button: the submit. Save draft is the outline one beside it.
    expect(screen.getAllByRole("button").filter((b) => (b as HTMLButtonElement).type === "submit").map((b) => b.textContent)).toEqual(["Save draft", "Save and resubmit to the Project Manager"]);
  });
  it("withdraw is a quiet link first; opening it shows what withdrawing does before the button", () => {
    render(<WithdrawProjectHandoverForm handoverId="h1" opportunityId="o1" />);
    expect(screen.queryByTestId("handover-withdraw-consequence")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Withdraw this handover" }));
    expect(screen.getByTestId("handover-withdraw-consequence").textContent).toMatch(/no project is created from it\. Nobody is notified/);
    expect(screen.getByRole("button", { name: "Withdraw handover" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep it" })).toBeTruthy();
  });
});
