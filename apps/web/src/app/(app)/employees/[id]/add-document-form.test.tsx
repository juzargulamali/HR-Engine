/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/employeeDocuments", () => ({ addDocument: vi.fn(async () => ({ error: null })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import { AddDocumentForm, type AddDocumentFormProps } from "./add-document-form";

const base: AddDocumentFormProps = { employeeId: "e1", employeeName: "Noura Test", companyName: "Enginious Local AE", countryCode: "AE", allowedStores: ["identity", "employee"], closeHref: "/employees/e1?tab=documents", defaultOpen: true };
afterEach(cleanup);
const choose = (key: string) => fireEvent.change(screen.getByTestId("add-document-type"), { target: { value: key } });

describe("AddDocumentForm", () => {
  it("shows the employee and company at the top and no fields until a type is chosen", () => {
    render(<AddDocumentForm {...base} />);
    expect(screen.getByTestId("add-document-context").textContent).toContain("Noura Test");
    expect(screen.getByTestId("add-document-context").textContent).toContain("Enginious Local AE");
    expect(screen.queryByTestId("add-document-number")).toBeNull();
    expect((screen.getByTestId("add-document-submit") as HTMLButtonElement).disabled).toBe(true);
  });
  it("offers the types usual for the country first", () => {
    render(<AddDocumentForm {...base} countryCode="SA" />);
    const groups = [...screen.getByTestId("add-document-type").querySelectorAll("optgroup")];
    expect(groups[0]!.label).toBe("Usual for SA");
    expect([...groups[0]!.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Iqama", "Visa"]);
    expect(groups[1]!.label).toBe("Other types");
  });
  it("an identity type asks for a number (required), a scan (optional) and an expiry date", () => {
    render(<AddDocumentForm {...base} />);
    choose("identity:passport");
    expect(screen.getByTestId("add-document-number")).toBeTruthy();
    expect(screen.getByText(/Scan/).textContent).toContain("Optional");
    expect(screen.getByText(/Expiry date/).textContent).toContain("Required");
  });
  it("a visa asks for a file (required) and no number", () => {
    render(<AddDocumentForm {...base} />);
    choose("employee:visa");
    expect(screen.queryByTestId("add-document-number")).toBeNull();
    expect(screen.getByText(/^File/).textContent).toContain("Required");
    expect(screen.getByTestId("add-document-effect").textContent).toMatch(/Adds a Visa to Noura Test's file; the expiry date is tracked/);
  });
  it("a type that does not expire hides the expiry date and says so", () => {
    render(<AddDocumentForm {...base} countryCode="PL" />);
    choose("identity:pesel");
    expect(screen.queryByTestId("add-document-expiry")).toBeNull();
    expect(screen.getByTestId("add-document-no-expiry").textContent).toMatch(/does not expire/);
    expect(screen.getByTestId("add-document-effect").textContent).toMatch(/does not expire/);
  });
  it("shows the missing field's sentence beside that field and does not submit", () => {
    render(<AddDocumentForm {...base} />);
    choose("identity:passport");
    fireEvent.submit(screen.getByTestId("add-document-submit").closest("form")!);
    expect(screen.getByRole("alert").textContent).toBe("Enter the Passport number.");
    expect(screen.getByTestId("add-document-number").getAttribute("aria-invalid")).toBe("true");
  });
  it("renewal locks the type, says the earlier document stays, and fills the earlier number", () => {
    render(<AddDocumentForm {...base} initialTypeKey="identity:passport" renew renewsDocumentId="d1" previousNumber="P-111" />);
    expect(screen.getByTestId("add-document-type-locked").textContent).toBe("Passport");
    expect(screen.queryByTestId("add-document-type")).toBeNull();
    expect(screen.getByText(/the earlier one stays in the history/)).toBeTruthy();
    expect((screen.getByTestId("add-document-number") as HTMLInputElement).value).toBe("P-111");
  });
  it("is one button until opened, and offers nothing to a viewer who may add no type", () => {
    const { container, rerender } = render(<AddDocumentForm {...base} defaultOpen={false} />);
    expect(screen.queryByTestId("add-document-form")).toBeNull();
    fireEvent.click(screen.getByTestId("add-document-open"));
    expect(screen.getByTestId("add-document-form")).toBeTruthy();
    rerender(<AddDocumentForm {...base} allowedStores={[]} />);
    expect(container.textContent).toBe("");
  });
  it("Escape closes the form", () => {
    render(<AddDocumentForm {...base} defaultOpen={false} />);
    fireEvent.click(screen.getByTestId("add-document-open"));
    fireEvent.keyDown(screen.getByTestId("add-document-form"), { key: "Escape" });
    expect(screen.queryByTestId("add-document-form")).toBeNull();
  });
});
