// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const createEmployee = vi.fn();
vi.mock("@/lib/actions/employeeOnboarding", () => ({ createEmployee: (...a: unknown[]) => createEmployee(...a) }));

import { NewEmployeeForm } from "./new-employee-form";

const companies = [
  { id: "c-ae", legal_name: "Fictional UAE", country_code: "AE", default_currency: "AED" },
  { id: "c-sa", legal_name: "Fictional Saudi", country_code: "SA", default_currency: "SAR" },
  { id: "c-pl", legal_name: "Fictional Poland", country_code: "PL", default_currency: "PLN" },
  { id: "c-x", legal_name: "Fictional No Defaults", country_code: null, default_currency: null },
];
const countries = [{ code: "AE", name: "United Arab Emirates" }, { code: "SA", name: "Saudi Arabia" }, { code: "PL", name: "Poland" }];
const departments = [{ id: "d1", company_id: "c-ae", name: "Warehouse" }, { id: "d2", company_id: "c-sa", name: "Engineering" }];
const managers = [{ id: "m1", company_id: "c-ae", first_name: "Mona", last_name: "Manager", employee_number: "E001" }];

afterEach(() => { cleanup(); createEmployee.mockReset(); });
vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
const choose = (id: string) => fireEvent.change(screen.getByLabelText("Company"), { target: { value: id } });
const setup = () => render(<NewEmployeeForm companies={companies} countries={countries} departments={departments} managers={managers} />);

describe("company-first onboarding", () => {
  it("asks only for the company until one is chosen, with none preselected", () => {
    setup();
    expect((screen.getByLabelText("Company") as HTMLSelectElement).value).toBe("");
    expect(screen.getByText("Choose a company")).toBeTruthy();
    expect(screen.queryByLabelText(/First name/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Create employee" })).toBeNull();
  });

  it.each([
    ["c-ae", "United Arab Emirates", "AED"],
    ["c-sa", "Saudi Arabia", "SAR"],
    ["c-pl", "Poland", "PLN"],
  ])("uses the company's own country and suggests its currency (%s)", (id, country, currency) => {
    setup();
    choose(id);
    expect((screen.getByLabelText("Country") as HTMLInputElement).value).toBe(country);
    expect((screen.getByLabelText("Company currency") as HTMLInputElement).value).toBe(currency);
    expect(screen.getByTestId("onboarding-summary").textContent).toContain(country);
    expect(screen.queryByTestId("country-missing")).toBeNull();
    // the pay currency defaults to the company's, so it is not typed again
    expect((document.querySelector("#salaryCurrency") as HTMLInputElement).value).toBe(currency);
  });

  it("asks for a missing country and currency in place", () => {
    setup();
    choose("c-x");
    expect(screen.getByTestId("country-missing").textContent).toMatch(/no country set/);
    expect((screen.getByLabelText("Country") as HTMLSelectElement).tagName).toBe("SELECT");
    expect(screen.getByTestId("currency-note").textContent).toMatch(/no default currency/);
    expect((document.querySelector("#salaryCurrency") as HTMLInputElement).value).toBe("");
  });

  it("offers only that company's departments and keeps contract, pay and balances optional and collapsed", () => {
    setup();
    choose("c-sa");
    const dept = screen.getByLabelText("Department") as HTMLSelectElement;
    expect([...dept.options].map((o) => o.textContent)).toEqual(["None", "Engineering"]);
    const details = [...document.querySelectorAll("details")];
    expect(details).toHaveLength(2);
    expect(details.every((d) => !d.open)).toBe(true);
    expect(details.map((d) => d.querySelector("summary")!.textContent)).toEqual(["Contract and pay now (optional)", "Opening balances (optional)"]);
    expect(screen.getByText(/Creates the employee and opens onboarding/)).toBeTruthy();
  });

  it("posts the form's id once per mount and keeps what was typed when the action answers with an error", async () => {
    createEmployee.mockResolvedValue({ error: "The employee could not be created. Nothing was saved. Check the details and try again." });
    setup();
    choose("c-ae");
    fireEvent.change(screen.getByLabelText("First name *"), { target: { value: "Riya" } });
    fireEvent.change(screen.getByLabelText("Last name *"), { target: { value: "Rigger" } });
    fireEvent.change(screen.getByLabelText("Hire date *"), { target: { value: "2026-11-01" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Create employee" })); });
    await waitFor(() => expect(createEmployee).toHaveBeenCalledTimes(1));
    const posted = createEmployee.mock.calls[0]![1] as FormData;
    expect(posted.get("employeeId")).toBe("11111111-1111-4111-8111-111111111111");
    expect(posted.get("companyId")).toBe("c-ae");
    // there is no number field: the number is assigned by the database, and the form says so
    expect(posted.has("employeeNumber")).toBe(false);
    expect(screen.queryByLabelText("Employee number *")).toBeNull();
    expect(screen.getByTestId("number-auto").textContent).toContain("Assigned automatically when you save");
    await waitFor(() => expect(screen.getByText(/could not be created/)).toBeTruthy());
    expect((screen.getByLabelText("First name *") as HTMLInputElement).value).toBe("Riya");
  });
});
