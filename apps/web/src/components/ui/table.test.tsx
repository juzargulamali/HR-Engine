/**
 * @vitest-environment jsdom
 */
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { StatusBadge } from "./status-badge";
import { StageBadge } from "@/components/sales/badges";

describe("stacked Table", () => {
  it("labels every cell but the first with its column heading, and leaves a spanning row alone", () => {
    const { container } = render(
      <Table stack>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Company</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
        <TableBody>
          <TableRow><TableCell>Eve</TableCell><TableCell>Acme</TableCell><TableCell>active</TableCell></TableRow>
          <TableRow><TableCell colSpan={3}>Nothing here</TableCell></TableRow>
        </TableBody>
      </Table>,
    );
    const cells = container.querySelectorAll("tbody tr:first-child td");
    expect(cells[0]!.getAttribute("data-label")).toBeNull();
    expect(cells[1]!.getAttribute("data-label")).toBe("Company");
    expect(cells[2]!.getAttribute("data-label")).toBe("Status");
    expect(container.querySelector("tbody tr:last-child td")!.getAttribute("data-label")).toBeNull();
    expect(container.querySelector("table")!.className).toContain("max-md:");
  });

  it("keeps a label a page wrote itself", () => {
    const { container } = render(
      <Table stack>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Company</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>Eve</TableCell><TableCell data-label="Employer">Acme</TableCell></TableRow></TableBody>
      </Table>,
    );
    expect(container.querySelectorAll("tbody td")[1]!.getAttribute("data-label")).toBe("Employer");
  });

  it("is a plain table without stack", () => {
    const { container } = render(<Table><TableBody><TableRow><TableCell>x</TableCell></TableRow></TableBody></Table>);
    expect(container.querySelector("table")!.className).not.toContain("max-md:");
  });
});

describe("status words keep a colour cue", () => {
  it("maps the same meaning to the same tone", () => {
    expect(render(<StatusBadge status="approved" />).container.querySelector(".os-badge")!.getAttribute("data-tone")).toBe("green");
    expect(render(<StatusBadge status="pending_approval" />).container.querySelector(".os-badge")!.getAttribute("data-tone")).toBe("amber");
    expect(render(<StatusBadge status="rejected" />).container.querySelector(".os-badge")!.getAttribute("data-tone")).toBe("red");
    expect(render(<StageBadge stage="won" />).container.querySelector(".os-badge")!.getAttribute("data-tone")).toBe("green");
    expect(render(<StageBadge stage="on_hold" />).container.querySelector(".os-badge")!.getAttribute("data-tone")).toBe("amber");
    // the words are always there
    expect(render(<StageBadge stage="qualified" />).container.textContent).toContain("Qualified");
  });
});
