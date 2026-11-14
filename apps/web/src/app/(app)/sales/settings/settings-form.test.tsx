/**
 * @vitest-environment jsdom
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const save = vi.fn();
vi.mock("@/lib/actions/crm", () => ({ saveCrmSettings: (...a: unknown[]) => save(...a) }));
import { hasUnsavedChanges, setDirty } from "@/components/workspace/unsaved";
import { fieldOfError, savedMessage, SettingsForm } from "./settings-form";

const initial = { referenceCode: "UAE", currency: "AED", responseTargetHours: null, workdays: [1, 2, 3, 4, 5], workStart: "09:00", workEnd: "18:00", holidays: "", duplicateWindowDays: 30, ownerEmailEnabled: false, approvalPolicy: "not_configured" as const, approvalNote: "" };
const form = (over: Partial<Parameters<typeof SettingsForm>[0]> = {}) => <SettingsForm companyId="c1" companyName="Enginious UAE" exists initial={initial} canEditApproval {...over} />;

beforeEach(() => { save.mockReset(); });
afterEach(() => { cleanup(); setDirty("sales-settings-c1", false); });

describe("Sales settings: reference code help text", () => {
  it("shows the whole reference an enquiry gets, including the OPP- prefix the database adds (crm_create_opportunity: OPP-<code>-<year>-<number>)", async () => {
    const html = renderToStaticMarkup(form({ canEditApproval: false }));
    expect(html).not.toMatch(/for example UAE-2026-0042/);
    // The example now sits behind the ⓘ beside the label; the format rule a person needs to fill the field in stays visible.
    expect(html).toContain("2 to 5 capital letters");
    render(form({ canEditApproval: false }));
    fireEvent.click(screen.getByTestId("info-hint-reference-code"));
    expect((await screen.findByRole("tooltip")).textContent).toContain("OPP-UAE-2026-0042");
  });
});

describe("Sales settings: one company, three groups, honest saving", () => {
  it("groups the settings as Response targets, Commercial approval and Estimates & VAT, in that order, each with its own jump target", () => {
    const html = renderToStaticMarkup(form());
    const at = ["Response targets", "Commercial approval", "Estimates &amp; VAT"].map((t) => html.indexOf(`>${t}<`));
    expect(at.every((i) => i > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const id of ["response-targets", "commercial-approval", "estimates-vat"]) expect(html).toContain(`id="${id}"`);
  });

  it("names the company and the group on every Save button", () => {
    render(form());
    expect(screen.getByRole("button", { name: "Save response targets for Enginious UAE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save commercial approval for Enginious UAE" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save estimates & VAT for Enginious UAE" })).toBeTruthy();
  });

  it("a company with no settings yet is set up with one save, and the button says so with its name", () => {
    render(form({ exists: false }));
    expect(screen.getAllByRole("button", { name: "Set up Sales for Enginious UAE" }).length).toBe(3);
    expect(screen.getAllByText("The first save writes every section of this page together.").length).toBe(3);
  });

  it("someone who may not change the approval policy sees it read-only, with no policy field sent and no Save button for it", () => {
    const { container } = render(form({ canEditApproval: false }));
    expect(container.querySelector('[name="approvalPolicy"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Save commercial approval for Enginious UAE" })).toBeNull();
    expect(screen.getByText(/Only a founder, or someone they have given approval-rule access, can change this/)).toBeTruthy();
  });

  it("keeps the consequence of the approval policy and of reminder emails visible, and moves the long rules behind ⓘ", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain("Until a policy is set, nothing can be approved");
    expect(html).toContain("Sales never sends anything to clients.");
    expect(html).not.toContain("Turn email on only after you have tested");   // behind the ⓘ
    expect(html).toContain('data-testid="info-hint-email-reminders"');
  });

  it("after a save it says which company and which group was saved, and that the one save wrote every section", async () => {
    save.mockResolvedValue({ error: null });
    render(form());
    fireEvent.change(screen.getByLabelText("First-response target (working hours)"), { target: { value: "4" } });
    expect(screen.getByText("Changes not saved yet")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save response targets for Enginious UAE" })); });
    const status = await screen.findByTestId("settings-saved");
    expect(status.textContent).toBe("Saved for Enginious UAE: response targets. One save writes every section of this page except the VAT choices, which save as each one is added.");
    expect(screen.queryByText("Changes not saved yet")).toBeNull();
    // One write, with every section's fields in it (what is stored is unchanged).
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0]![1] as FormData;
    expect(sent.get("companyId")).toBe("c1");
    expect(sent.get("responseTargetHours")).toBe("4");
    expect(sent.get("referenceCode")).toBe("UAE");
    expect(sent.get("approvalPolicy")).toBe("not_configured");
  });

  it("says so when a Save button also carries unsaved changes from another group", () => {
    render(form());
    fireEvent.change(screen.getByLabelText("Duplicate window (days)"), { target: { value: "60" } });
    expect(screen.getAllByText("Also saves your changes under Estimates & VAT.").length).toBe(2);   // beside the other two buttons
  });

  it("a refused save keeps what was typed and puts the message beside the setting", async () => {
    save.mockResolvedValue({ error: "Reference code: 2 to 5 capital letters" });
    render(form());
    const code = screen.getByLabelText("Reference code") as HTMLInputElement;
    fireEvent.change(code, { target: { value: "UAX" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save estimates & VAT for Enginious UAE" })); });
    const beside = await screen.findByTestId("settings-error-referenceCode");
    expect(beside.textContent).toBe("Reference code: 2 to 5 capital letters");
    expect(code.parentElement!.contains(beside)).toBe(true);
    expect(code.value).toBe("UAX");
    expect(screen.getByTestId("settings-not-saved").textContent).toContain("Not saved for Enginious UAE.");
    expect(screen.queryByTestId("settings-saved")).toBeNull();
    expect(screen.getByText("Changes not saved yet")).toBeTruthy();
  });

  it("an incomplete working calendar is refused before anything is sent, beside the calendar, and nothing typed is lost", async () => {
    render(form());
    const start = screen.getByLabelText("Working day starts (Dubai time)") as HTMLInputElement;
    fireEvent.change(start, { target: { value: "" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save response targets for Enginious UAE" })); });
    expect(screen.getByTestId("settings-error-calendar").textContent).toContain("needs working days, a start time and an end time together");
    expect(save).not.toHaveBeenCalled();
    expect((screen.getByLabelText("Working day ends (Dubai time)") as HTMLInputElement).value).toBe("18:00");
  });

  it("warns before leaving with unsaved changes (another company, another page), and not once they are saved", async () => {
    save.mockResolvedValue({ error: null });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<>{form()}<a href="/sales/settings?company=c2">Enginious KSA</a></>);
    const link = screen.getByRole("link", { name: "Enginious KSA" });
    link.addEventListener("click", (e) => e.preventDefault());   // jsdom does not navigate; this only keeps it quiet
    expect(fireEvent.click(link)).toBe(false);
    expect(confirm).not.toHaveBeenCalled();                       // nothing typed yet: no question
    fireEvent.change(screen.getByLabelText("Duplicate window (days)"), { target: { value: "60" } });
    await waitFor(() => expect(hasUnsavedChanges()).toBe(true));
    fireEvent.click(link);
    expect(confirm).toHaveBeenCalledWith("You have changes to the Sales settings of Enginious UAE that are not saved. Leave without saving them?");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save estimates & VAT for Enginious UAE" })); });
    await screen.findByTestId("settings-saved");
    await waitFor(() => expect(hasUnsavedChanges()).toBe(false));
    confirm.mockClear();
    fireEvent.click(link);
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

describe("Sales settings: the words after a save", () => {
  it("names the company and the groups that had changes", () => {
    expect(savedMessage("Enginious UAE", ["response"], false)).toContain("Saved for Enginious UAE: response targets.");
    expect(savedMessage("Enginious UAE", ["response", "approval"], false)).toContain("Saved for Enginious UAE: response targets and commercial approval.");
    expect(savedMessage("Enginious UAE", ["response", "approval", "estimates"], false)).toContain("response targets, commercial approval and estimates & VAT.");
    expect(savedMessage("Enginious UAE", [], false)).toBe("Saved for Enginious UAE. Nothing had been changed, so the settings are as they were.");
    expect(savedMessage("Enginious KSA", ["estimates"], true)).toContain("Sales is set up for Enginious KSA");
  });
  it("places a refusal beside the setting it is about", () => {
    expect(fieldOfError("Reference code: 2 to 5 capital letters")).toBe("referenceCode");
    expect(fieldOfError("Currency: a 3-letter code such as AED")).toBe("currency");
    expect(fieldOfError("Holidays must be dates like 2026-12-02, separated by commas or spaces.")).toBe("holidays");
    expect(fieldOfError("Working hours must end after they start.")).toBe("calendar");
    expect(fieldOfError("You are not allowed to do that.")).toBeNull();
  });
});
