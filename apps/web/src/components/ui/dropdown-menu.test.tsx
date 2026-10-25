/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import { placeMenu } from "./dropdown-menu";

const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

function setup(opts: { button: DOMRect; clip?: DOMRect; menuWidth?: number; menuHeight?: number }) {
  const parent = document.createElement("div");
  parent.style.overflowX = opts.clip ? "auto" : "visible";
  parent.style.overflowY = opts.clip ? "auto" : "visible";
  const wrap = document.createElement("div");
  const menu = document.createElement("div");
  parent.append(wrap);
  document.body.append(parent);
  parent.getBoundingClientRect = () => opts.clip ?? rect(0, 0, 0, 0);
  wrap.getBoundingClientRect = () => opts.button;
  Object.defineProperty(menu, "offsetWidth", { value: opts.menuWidth ?? 240 });
  Object.defineProperty(menu, "offsetHeight", { value: opts.menuHeight ?? 120 });
  return { wrap, menu, done: () => parent.remove() };
}

describe("placeMenu", () => {
  it("leaves a list alone when it fits", () => {
    const { wrap, menu, done } = setup({ button: rect(800, 100, 900, 130), clip: rect(500, 0, 1000, 800) });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    expect(placeMenu(wrap, menu, "end", "bottom")).toEqual({ x: 0, flipUp: false });
    done();
  });

  it("moves a list that opens to the left of a button at the left edge of its panel back inside the panel", () => {
    // the button ends at 340, the panel starts at 320: an end-aligned list of 240 would start at 100 and be cut off
    const { wrap, menu, done } = setup({ button: rect(240, 100, 340, 130), clip: rect(320, 0, 1000, 800) });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    const { x } = placeMenu(wrap, menu, "end", "bottom");
    expect(100 + x).toBeGreaterThanOrEqual(320); // the list now starts inside the panel
    done();
  });

  it("moves a list that would run past the right edge back inside", () => {
    const { wrap, menu, done } = setup({ button: rect(900, 100, 990, 130), clip: rect(320, 0, 1000, 800) });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 900, configurable: true });
    const { x } = placeMenu(wrap, menu, "start", "bottom");
    expect(900 + x + 240).toBeLessThanOrEqual(1000);
    done();
  });

  it("opens upwards when there is no room below but room above", () => {
    const { wrap, menu, done } = setup({ button: rect(600, 700, 700, 730), menuHeight: 200 });
    Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    expect(placeMenu(wrap, menu, "end", "bottom").flipUp).toBe(true);
    done();
  });
});
