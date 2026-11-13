// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { timelineScale, type TimelineModel, type TimelineRow } from "@/lib/projects/delivery-plan/insights";

vi.mock("next/link", () => ({ default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => <a href={href} {...(rest as Record<string, unknown>)}>{children}</a> }));
import { PlanTimeline } from "./plan-timeline";

afterEach(() => { cleanup(); vi.restoreAllMocks(); Reflect.deleteProperty(window, "matchMedia"); });
beforeEach(() => { Reflect.deleteProperty(window, "matchMedia"); });

const row = (key: string, label: string, start: string | null, due: string | null, over: Partial<TimelineRow> = {}): TimelineRow => ({
  key, kind: "line", label, sub: `L-${key} · Fictional Cara`, owner: "Fictional Cara", status: "Task in progress", tone: "blue", start, due,
  shape: start && due ? (start === due ? "single" : "range") : due ? "due" : start ? "start" : "none", inherited: false, unscheduled: !start && !due, late: null, blocked: false, anchor: `dp-${key}`, itemKey: "D001", ...over,
});
const modelOf = (rows: TimelineRow[], span?: { start: string; end: string }): TimelineModel => {
  const dates = rows.flatMap((r) => [r.start, r.due]).filter((x): x is string => !!x).sort();
  const range = span ?? (dates.length ? { start: dates[0]!, end: dates.at(-1)! } : null);
  return { rows, range, scale: range ? timelineScale(range) : null, unscheduled: rows.filter((r) => r.unscheduled) };
};
const show = (m: TimelineModel, today = "2027-04-10") => render(<PlanTimeline projectId="p1" model={m} today={today} />);
const region = () => screen.getByTestId("tl-scroll");
const chartVar = () => (region().firstElementChild as HTMLElement).style.getPropertyValue("--tl-chart");
const metrics = (el: HTMLElement, v: { clientWidth?: number; scrollWidth?: number; scrollLeft?: number; offsetWidth?: number }) => {
  for (const [k, x] of Object.entries(v)) Object.defineProperty(el, k, { configurable: true, writable: true, value: x });
};

const seven = () => modelOf([row("a", "Storyboard", "2027-04-04", "2027-04-10"), row("b", "Build", "2027-04-06", "2027-04-08")]);
const nine = () => modelOf([row("a", "Storyboard", "2027-04-04", "2027-04-12")]);
const thirty = () => modelOf([row("a", "Storyboard", "2027-04-01", "2027-04-10"), row("b", "App build", "2027-04-12", "2027-04-30", { owner: null, status: "Draft: not released" })]);

describe("Work schedule chart: day width and what scrolls", () => {
  it("gives every day at least 56px: 7 days fit (392px), 9 and 30 days are wider than a screen and scroll inside the chart box", () => {
    show(seven());
    expect(chartVar()).toBe("392px");
    cleanup();
    show(nine());
    expect(chartVar()).toBe("504px");
    cleanup();
    show(thirty());
    expect(chartVar()).toBe("1680px");
    // the box that scrolls is the chart itself; the page is not made wider: the containers can shrink and clip
    expect(region().className).toMatch(/overflow-auto/);
    expect(region().className).toMatch(/max-w-full/);
    expect(screen.getByTestId("plan-timeline").className).toMatch(/min-w-0/);
    expect(screen.getByTestId("plan-timeline").className).toMatch(/max-w-full/);
  });

  it("keeps the names and the date header pinned, a labelled Today marker in range, and exact dates on every row", () => {
    show(thirty());
    expect(screen.getByTestId("tl-corner").className).toMatch(/sticky/);
    expect(screen.getByTestId("tl-header").parentElement!.className).toMatch(/sticky top-0/);
    const first = screen.getAllByTestId("tl-row-line")[0]!;
    expect(first.firstElementChild!.className).toMatch(/sticky left-0/);
    expect(screen.getByTestId("tl-today-marker").textContent).toBe("Today");
    expect(screen.getByTestId("tl-dates-a").textContent).toBe("1–10 Apr");
    expect(screen.getByTestId("tl-dates-b").textContent).toBe("12–30 Apr");
    cleanup();
    show(thirty(), "2027-06-01");                                                                       // today outside the schedule: no marker
    expect(screen.queryByTestId("tl-today-marker")).toBeNull();
  });
});

describe("Day / Week switch", () => {
  it("is a pressed-state pair; Week groups the scale by week while every row keeps its exact dates, and Day returns to a column per day", () => {
    show(thirty());
    expect(screen.getByTestId("tl-mode-day").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("tl-mode-week").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("tl-col-2027-04-02")).toBeTruthy();
    fireEvent.click(screen.getByTestId("tl-mode-week"));
    expect(screen.getByTestId("plan-timeline").getAttribute("data-mode")).toBe("week");
    expect(screen.getByTestId("tl-mode-week").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("tl-col-2027-04-02")).toBeNull();
    expect(screen.getByTestId("tl-col-2027-04-08").textContent).toBe("8 Apr");                           // weekly labels
    expect(screen.getByTestId("tl-dates-a").textContent).toBe("1–10 Apr");                               // exact dates unchanged
    expect(screen.getByTestId("tl-dates-b").textContent).toBe("12–30 Apr");
    expect(chartVar()).toBe("540px");                                                                   // 30 days at 18px
    fireEvent.click(screen.getByTestId("tl-mode-day"));
    expect(screen.getByTestId("plan-timeline").getAttribute("data-mode")).toBe("day");
    expect(chartVar()).toBe("1680px");
  });

  it("the person's choice beats the automatic one: a long schedule opens in Week and can be switched to Day", () => {
    show(modelOf([row("a", "Install", "2027-04-01", "2027-07-15")]));
    expect(screen.getByTestId("plan-timeline").getAttribute("data-mode")).toBe("week");
    fireEvent.click(screen.getByTestId("tl-mode-day"));
    expect(screen.getByTestId("plan-timeline").getAttribute("data-mode")).toBe("day");
    expect(screen.getByTestId("plan-timeline").getAttribute("data-user-mode")).toBe("day");
  });
});

describe("Today jump and keyboard scrolling", () => {
  const prepare = () => {
    const el = region();
    const scrollTo = vi.fn();
    Object.defineProperty(el, "scrollTo", { configurable: true, value: scrollTo });
    metrics(el, { clientWidth: 900, scrollWidth: 256 + 1680, scrollLeft: 0 });
    metrics(screen.getByTestId("tl-header"), { offsetWidth: 1680 });
    metrics(screen.getByTestId("tl-corner"), { offsetWidth: 256 });
    return scrollTo;
  };

  it("jumps to today, centring it, smoothly", () => {
    show(thirty());
    const scrollTo = prepare();
    fireEvent.click(screen.getByTestId("tl-today-jump"));                                               // 10 April: index 9, centre 9.5 * 56 = 532; the chart area is 644 wide
    expect(scrollTo).toHaveBeenCalledWith({ left: Math.round(532 - (900 - 256) / 2), behavior: "smooth" });
  });

  it("respects reduced motion: the same jump, without animation", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    show(thirty());
    const scrollTo = prepare();
    fireEvent.click(screen.getByTestId("tl-today-jump"));
    expect(scrollTo.mock.calls[0]![0].behavior).toBe("auto");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("is disabled, and says why, when today is outside the schedule", () => {
    show(thirty(), "2027-08-01");
    const b = screen.getByTestId("tl-today-jump") as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toBe("Today is outside this schedule");
  });

  it("the chart is a focusable, labelled region; arrows, Page Up / Down, Home and End scroll it, and arrows inside a link keep their own meaning", () => {
    show(thirty());
    const scrollTo = prepare();
    expect(region().getAttribute("role")).toBe("region");
    expect(region().getAttribute("tabindex")).toBe("0");
    expect(region().getAttribute("aria-label")).toMatch(/Work schedule chart/);
    metrics(region(), { scrollLeft: 300 });
    fireEvent.keyDown(region(), { key: "ArrowRight" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 380, behavior: "smooth" });
    fireEvent.keyDown(region(), { key: "ArrowLeft" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 220, behavior: "smooth" });
    fireEvent.keyDown(region(), { key: "PageDown" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 300 + 720, behavior: "smooth" });
    fireEvent.keyDown(region(), { key: "PageUp" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });                          // 300 - 720, never below zero
    fireEvent.keyDown(region(), { key: "End" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 256 + 1680, behavior: "smooth" });
    fireEvent.keyDown(region(), { key: "Home" });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "smooth" });
    const calls = scrollTo.mock.calls.length;
    fireEvent.keyDown(within(screen.getAllByTestId("tl-row-line")[0]!).getByRole("link", { name: "Storyboard" }), { key: "ArrowRight" });
    expect(scrollTo.mock.calls.length).toBe(calls);                                                    // a link is not hijacked
    fireEvent.keyDown(region(), { key: "Tab" });
    expect(scrollTo.mock.calls.length).toBe(calls);                                                    // and Tab is never trapped
  });
});

describe("offscreen cue", () => {
  it("shows a soft edge on the side that has more dates, and updates as the chart scrolls", () => {
    show(thirty());
    expect(screen.queryByTestId("tl-more-left")).toBeNull();
    metrics(region(), { clientWidth: 500, scrollWidth: 1936, scrollLeft: 0 });
    fireEvent.scroll(region());
    expect(screen.getByTestId("tl-more-right")).toBeTruthy();
    expect(screen.queryByTestId("tl-more-left")).toBeNull();
    metrics(region(), { scrollLeft: 400 });
    fireEvent.scroll(region());
    expect(screen.getByTestId("tl-more-left")).toBeTruthy();
    expect(screen.getByTestId("tl-more-right")).toBeTruthy();
    metrics(region(), { scrollLeft: 1436 });
    fireEvent.scroll(region());
    expect(screen.getByTestId("tl-more-left")).toBeTruthy();
    expect(screen.queryByTestId("tl-more-right")).toBeNull();
    expect(screen.getByTestId("tl-more-left").getAttribute("aria-hidden")).toBe("true");              // decoration only
  });
});

describe("tooltip", () => {
  const bar = (k: string) => screen.getByTestId(`tl-bar-${k}`);

  it("keyboard focus shows the task, owner, status and exact dates, linked to the bar; Escape and blur close it", () => {
    show(thirty());
    expect(bar("a").tagName).toBe("BUTTON");                                                             // reachable with Tab
    fireEvent.focus(bar("a"));
    const tip = screen.getByTestId("tl-tooltip");
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(bar("a").getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.textContent).toMatch(/Storyboard/);
    expect(tip.textContent).toMatch(/Owner: Fictional Cara/);
    expect(tip.textContent).toMatch(/Status: Task in progress/);
    expect(tip.textContent).toMatch(/Dates: 1 Apr 2027 to 10 Apr 2027/);
    expect(tip.textContent).toMatch(/Read only/);
    expect(tip.className).toMatch(/pointer-events-none/);                                                // hover and focus never trap the pointer
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
    fireEvent.focus(bar("b"));
    expect(screen.getByTestId("tl-tooltip").textContent).toMatch(/Owner: No owner yet/);
    fireEvent.blur(bar("b"));
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
  });

  it("hover shows it and leaving hides it; moving the chart drops it", () => {
    show(thirty());
    fireEvent.mouseEnter(bar("a"));
    expect(screen.getByTestId("tl-tooltip")).toBeTruthy();
    fireEvent.mouseLeave(bar("a"));
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
    fireEvent.mouseEnter(bar("a"));
    fireEvent.scroll(region());
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
  });

  it("a tap pins the same details with a link to the record; a second tap, Escape or a tap elsewhere closes it", () => {
    show(thirty());
    fireEvent.click(bar("a"));
    let tip = screen.getByTestId("tl-tooltip");
    expect(tip.className).toMatch(/pointer-events-auto/);
    expect(within(tip).getByRole("link", { name: "Open this requirement" }).getAttribute("href")).toBe("/projects/p1/delivery?open=D001#dp-a");
    fireEvent.mouseLeave(bar("a"));
    expect(screen.getByTestId("tl-tooltip")).toBeTruthy();                                               // pinned: leaving does not close it
    fireEvent.click(bar("a"));
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
    fireEvent.click(bar("b"));
    fireEvent.click(bar("a"));                                                                          // another bar replaces it
    tip = screen.getByTestId("tl-tooltip");
    expect(tip.textContent).toMatch(/Storyboard/);
    act(() => { document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); });
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
    fireEvent.click(bar("a"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("tl-tooltip")).toBeNull();
  });

  it("clears the chart edges: kept inside the box on the right and on the left, and flipped below when there is no room above", () => {
    show(thirty());
    const wrap = { left: 100, top: 100, width: 600, height: 400, right: 700, bottom: 500, x: 100, y: 100, toJSON: () => ({}) };
    let barRect = { left: 690, top: 300, width: 20, height: 16, right: 710, bottom: 316, x: 690, y: 300, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return (this.hasAttribute("data-tl-bar") ? barRect : wrap) as DOMRect; });
    fireEvent.focus(bar("a"));
    let tip = screen.getByTestId("tl-tooltip");
    const left = parseFloat(tip.style.left), width = parseFloat(tip.style.width);
    expect(left + width).toBeLessThanOrEqual(600 - 4);                                                  // inside the right edge
    expect(tip.getAttribute("data-placement")).toBe("above");
    fireEvent.blur(bar("a"));
    barRect = { ...barRect, left: 60, right: 80, x: 60 };                                                // left of the box (scrolled partly out of view)
    fireEvent.focus(bar("a"));
    tip = screen.getByTestId("tl-tooltip");
    expect(parseFloat(tip.style.left)).toBeGreaterThanOrEqual(4);                                       // inside the left edge
    fireEvent.blur(bar("a"));
    barRect = { ...barRect, left: 300, right: 320, x: 300, top: 130, bottom: 146, y: 130 };              // near the top: not enough room above
    fireEvent.focus(bar("a"));
    tip = screen.getByTestId("tl-tooltip");
    expect(tip.getAttribute("data-placement")).toBe("below");
    expect(tip.style.transform).toBe("");
  });

  it("has no handle to move or resize a bar: they are read-only", () => {
    show(thirty());
    expect(bar("a").getAttribute("draggable")).toBeNull();
    expect(bar("a").getAttribute("aria-label")).toMatch(/Read only/);
    expect(screen.getByTestId("plan-timeline").textContent).toMatch(/Bars are read-only: change a date on the task or in the Breakdown/);
  });
});
