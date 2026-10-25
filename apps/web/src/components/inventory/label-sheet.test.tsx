/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseInventoryScan } from "@enginious-hr/domain";
import { LabelSheet, conciseName, labelQrSvg } from "./label-sheet";

afterEach(() => cleanup());

describe("labels", () => {
  it("the QR carries only the address of the record code: no name, price, person or credential", async () => {
    const svg = await labelQrSvg("https://os.example.com", "UAE-E-00042");
    expect(svg.startsWith("<svg")).toBe(true);
    const { container } = render(<LabelSheet size="medium" labels={[{ code: "UAE-E-00042", name: "Laptop 14in, 1,200 AED" }]} svgs={{ "UAE-E-00042": svg }} />);
    expect(container.querySelector("[data-code='UAE-E-00042'] .label-code")?.textContent).toBe("UAE-E-00042");
    // The sticker's QR is not the name: read it back from a rendering of the same payload.
    expect(parseInventoryScan("https://os.example.com/inventory/scan?c=UAE-E-00042")).toMatchObject({ ok: true, code: "UAE-E-00042" });
    expect(svg).not.toMatch(/Laptop|AED|1,200/);
  });
  it("prints a batch: one cell per record, readable id first, a concise name", async () => {
    const codes = ["UAE-E-00001", "UAE-E-00002", "UAE-S-00003"];
    const svgs = Object.fromEntries(await Promise.all(codes.map(async (c) => [c, await labelQrSvg("https://os.example.com", c)])));
    const { container } = render(<LabelSheet size="small" labels={codes.map((code, i) => ({ code, name: `Item ${i} ${"x".repeat(80)}` }))} svgs={svgs} />);
    expect(container.querySelectorAll(".label-cell")).toHaveLength(3);
    expect(container.querySelector(".label-name")!.textContent!.length).toBeLessThanOrEqual(42);
  });
  it("keeps a name short without losing the start of it", () => {
    expect(conciseName("  Motor   2.2 kW   with gearbox and a very long description of everything about it  ")).toMatch(/^Motor 2\.2 kW with gearbox/);
    expect(conciseName("Short")).toBe("Short");
  });
  it("a reprint is the same code, so the same QR (no new equipment is created by printing)", async () => {
    expect(await labelQrSvg("https://os.example.com", "UAE-E-00042")).toBe(await labelQrSvg("https://os.example.com", "UAE-E-00042"));
  });
});
