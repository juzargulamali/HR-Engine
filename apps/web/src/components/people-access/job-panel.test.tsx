// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
const addDepartment = vi.fn();
const updateJobDetails = vi.fn();
vi.mock("@/lib/actions/peopleAccess", () => ({ addDepartment: (...a: unknown[]) => addDepartment(...a), updateJobDetails: (...a: unknown[]) => updateJobDetails(...a) }));

import { JobPanel, type JobPanelProps } from "./job-panel";

const base: JobPanelProps = {
  employeeId: "e1", personName: "Riya Rigger", companyName: "Fictional UAE", jobTitle: "Technician", departmentId: null, departmentName: null, managerId: null, managerName: null,
  canEdit: true, departments: [], departmentsLoaded: true, managers: [],
};
afterEach(() => { cleanup(); addDepartment.mockReset(); updateJobDetails.mockReset(); });

describe("Job & department: departments", () => {
  it("an empty company says there are none yet and offers to add the first", () => {
    render(<JobPanel {...base} />);
    expect(screen.getByText("No departments have been created for Fictional UAE yet. Add the first one below.")).toBeTruthy();
    expect((screen.getByLabelText("Department") as HTMLSelectElement).options).toHaveLength(1);       // only "None"
    expect(screen.getByRole("button", { name: "Add department" })).toBeTruthy();
    expect(screen.queryByTestId("pa-departments-failed")).toBeNull();
  });

  it("a failed load is a different message: no list, no Add department, and a save posts the current department back unchanged", () => {
    render(<JobPanel {...base} departmentId="d9" departmentsLoaded={false} />);
    expect(screen.getByTestId("pa-departments-failed").textContent).toContain("Departments could not be loaded. Reload the page to try again. Saving now leaves the department as it is.");
    expect(screen.queryByText(/No departments have been created/)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Department" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add department" })).toBeNull();
    expect((document.querySelector('input[type="hidden"][name="departmentId"]') as HTMLInputElement).value).toBe("d9");
    expect(screen.getByText("Could not be loaded")).toBeTruthy();                                        // the current department is not shown as "none"
  });

  it("a new department is offered and selected at once, before the page refreshes", async () => {
    addDepartment.mockResolvedValue({ error: null, id: "d2", name: "Engineering" });
    render(<JobPanel {...base} departments={[{ id: "d1", name: "Warehouse" }]} />);
    fireEvent.change(screen.getByLabelText("Add a department for Fictional UAE"), { target: { value: "Engineering" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add department" })); });
    const select = screen.getByLabelText("Department") as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("d2"));
    expect([...select.options].map((o) => o.textContent)).toEqual(["None", "Engineering", "Warehouse"]);
    expect((addDepartment.mock.calls[0]![1] as FormData).get("employeeId")).toBe("e1");
    expect((addDepartment.mock.calls[0]![1] as FormData).get("name")).toBe("Engineering");
  });

  it("a refusal is shown in words and nothing is added to the list", async () => {
    addDepartment.mockResolvedValue({ error: 'This company already has a department called "Warehouse". Choose it in the list.' });
    render(<JobPanel {...base} departments={[{ id: "d1", name: "Warehouse" }]} />);
    fireEvent.change(screen.getByLabelText("Add a department for Fictional UAE"), { target: { value: "warehouse" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add department" })); });
    await waitFor(() => expect(screen.getByText(/already has a department called "Warehouse"/)).toBeTruthy());
    expect((screen.getByLabelText("Department") as HTMLSelectElement).options).toHaveLength(2);
  });

  it("someone who cannot edit job details sees no list and no Add department", () => {
    render(<JobPanel {...base} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "Add department" })).toBeNull();
    expect(screen.getByText("Only an HR Admin of Fictional UAE can change these details.")).toBeTruthy();
  });
});
