// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));

import { HandoverBrief } from "./handover-brief";

afterEach(cleanup);

// Fictional handover.
const h = { client_name: "Fictional Motors", location: "Expo Hall 4", site_timezone: "Asia/Dubai", install_start: "2027-02-26", event_start: "2027-03-01", event_end: "2027-03-05", technologies: [], scope: null, exclusions: null, risks: [], notes: null, crm_reference: "UAE-2027-0042" };

describe("the event edition on a handover brief", () => {
  it("shows the edition label when the handover has one", () => {
    render(<HandoverBrief h={{ ...h, edition_snapshot: { label: "Fictional Expo · 2027 · Dubai", event_name: "Fictional Expo" } }} />);
    expect(screen.getByText("Event edition")).toBeTruthy();
    expect(screen.getByText("Fictional Expo · 2027 · Dubai")).toBeTruthy();
  });
  it("shows nothing about an edition when the handover has none", () => {
    render(<HandoverBrief h={{ ...h, edition_snapshot: null }} />);
    expect(screen.queryByText("Event edition")).toBeNull();
    cleanup();
    render(<HandoverBrief h={h} />);
    expect(screen.queryByText("Event edition")).toBeNull();
  });
});
