import { describe, expect, it } from "vitest";
import { outputLinkLines } from "./my-work-outputs";

const rows = [
  { id: "t1", title: "Logo reveal", projectName: "Expo", projectReference: "UAE-P-1" },
  { id: "t2", title: "Floor plan", projectName: "Expo", projectReference: "UAE-P-1" },
  { id: "t3", title: "No output", projectName: "Expo", projectReference: "UAE-P-1" },
];
const outputs = { t1: { versionId: "v1", versionNo: 2, status: "awaiting" as const }, t2: { versionId: "v2", versionNo: 1, status: "changes_requested" as const } };
const href = (t: string, v: string) => `/projects/work?task=${t}&version=${v}`;

describe("My Work output links", () => {
  it("lists only the tasks whose open version matches the view, each linking to that exact version", () => {
    expect(outputLinkLines("waiting", rows, outputs, href)).toEqual([{ taskId: "t1", versionId: "v1", title: "Logo reveal", context: "UAE-P-1 Expo", text: "Version 2 is waiting for review", href: "/projects/work?task=t1&version=v1" }]);
    expect(outputLinkLines("review", rows, outputs, href)[0]!.text).toBe("Version 2 is waiting for your review");
    expect(outputLinkLines("changes", rows, outputs, href).map((l) => l.href)).toEqual(["/projects/work?task=t2&version=v2"]);
    expect(outputLinkLines("changes", rows, outputs, href)[0]!.text).toMatch(/Changes were requested on version 1/);
  });
  it("a task without an open version has no line", () => {
    expect(outputLinkLines("waiting", [rows[2]!], outputs, href)).toEqual([]);
  });
});
