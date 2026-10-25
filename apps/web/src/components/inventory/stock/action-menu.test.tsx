/**
 * @vitest-environment jsdom
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormContext } from "@/lib/inventory/stock-candidates";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
let seen: { align?: string; label?: string } = {};
vi.mock("@/components/workspace/more-menu", () => ({ MoreMenu: (p: { align?: string; label?: string }) => { seen = p; return <button type="button">{p.label}</button>; } }));

import { ActionMenu } from "./action-menu";

const context: FormContext = { locations: [], destinations: [], projects: [], requests: [], transfers: [], rentals: [], canSeeCostsByCompany: {} };
afterEach(() => cleanup());

describe("ActionMenu", () => {
  it("opens towards the right, so the list stays inside the side panel it sits at the left of", () => {
    render(<ActionMenu specs={[{ key: "add-unit", label: "Add unit", dialog: { title: "Add a unit" } }]} context={context} />);
    expect(seen.align).toBe("start");
    expect(seen.label).toBe("More actions");
  });
});
