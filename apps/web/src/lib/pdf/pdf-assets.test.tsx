// @vitest-environment node
import { createElement } from "react";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";

vi.mock("server-only", () => ({}));

// C0.5. The PDF documents read their logo and fonts through process.cwd() (the app root, apps/web). Vercel bundles those files only because the build traces
// the literal path.join(process.cwd(), ...) calls, so this test pins the three things that must stay true for it to keep working: the files are at those
// exact paths, the PDF really embeds the Carlito fonts (not a fallback face), and it embeds the logo.
describe("PDF fonts and logo", () => {
  it("are at the paths the PDF components read, relative to the app root", () => {
    for (const rel of ["public/brand/enginious-logo.png", "src/lib/pdf/fonts/Carlito-Regular.ttf", "src/lib/pdf/fonts/Carlito-Bold.ttf"]) {
      expect(existsSync(path.join(process.cwd(), rel)), rel).toBe(true);
    }
  });

  it("are embedded in a rendered PDF: Carlito Regular and Bold, and the logo image", async () => {
    const { PlanDocument } = await import("./plan-document");
    const payload = {
      project: { reference: "UAE-P-2026-0001", name: "Floor projection", client_name: "Orbit Motors", location: "Expo Hall 3", site_timezone: "Asia/Dubai" },
      milestones: [{ title: "First draft", due_date: "2099-03-01" }],
      delivery: [],
      site: [],
      dependencies: [],
    };
    const buf = await renderToBuffer(createElement(PlanDocument, { payload, version: 1, clientReference: "UAE-P-2026-0001", title: "Floor projection", tz: "Asia/Dubai", issuedAt: "2099-03-01T08:00:00Z" } as never) as never);
    const text = buf.toString("latin1");
    expect(text).toMatch(/\+Carlito-Regular/);
    expect(text).toMatch(/\+Carlito-Bold/);
    expect(text).toMatch(/\/Subtype \/Image/);
    expect(text).not.toMatch(/Helvetica/);
  });
});
