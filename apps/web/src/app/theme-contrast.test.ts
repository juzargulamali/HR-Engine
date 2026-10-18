import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the readability of the two themes (WCAG 2.1 AA) at the source: it reads the real token values out of globals.css and
 * checks the combinations the app actually uses. A token change that makes secondary text, a control boundary, a button or a
 * focus ring too faint fails here, before anyone has to notice it on screen. The rendered pages are measured separately
 * (docs/os-theme-contrast.md); this test only covers the tokens.
 */
const css = readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in globals.css`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

type Rgb = [number, number, number];
function hsl(value: string): Rgb {
  const [h, s, l] = value.split(/\s+/).map((v) => parseFloat(v)) as [number, number, number];
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return L - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as Rgb;
}
function luminance([r, g, b]: Rgb): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(hsl(a)), luminance(hsl(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { dark: block(":root"), light: { ...block(":root"), ...block(':root[data-theme="light"]') } };

describe.each(Object.entries(THEMES))("%s theme tokens meet WCAG AA", (_name, t) => {
  const surfaces = ["background", "chrome", "card", "raised", "field"] as const;

  it.each(surfaces)("primary text is at least 7:1 on %s", (s) => {
    expect(ratio(t.foreground!, t[s]!)).toBeGreaterThanOrEqual(7);
  });
  it.each(surfaces)("secondary text is at least 4.5:1 on %s", (s) => {
    expect(ratio(t["muted-foreground"]!, t[s]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("secondary text is also readable on the hover/selected fill", () => {
    expect(ratio(t["muted-foreground"]!, t.secondary!)).toBeGreaterThanOrEqual(4.5);
  });
  it("the quiet tertiary text (labels, 'Coming soon') is at least 4.5:1 on the sidebar, header and cards", () => {
    for (const s of ["chrome", "card", "background"] as const) expect(ratio(t.subtle!, t[s]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("text keeps a clear hierarchy: primary is stronger than secondary, secondary stronger than tertiary", () => {
    expect(ratio(t.foreground!, t.card!)).toBeGreaterThan(ratio(t["muted-foreground"]!, t.card!));
    expect(ratio(t["muted-foreground"]!, t.card!)).toBeGreaterThan(ratio(t.subtle!, t.card!) - 0.01);
  });
  it.each(["primary", "accent", "destructive", "success", "warning"] as const)("%s reads as text on cards and the sidebar (4.5:1)", (k) => {
    expect(ratio(t[k]!, t.card!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t[k]!, t.chrome!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each([
    ["primary", "primary-foreground"],
    ["accent", "accent-foreground"],
    ["destructive", "destructive-foreground"],
    ["success", "success-foreground"],
    ["warning", "warning-foreground"],
  ])("button and badge text on %s fill is at least 4.5:1", (fill, fg) => {
    expect(ratio(t[fg]!, t[fill]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("both ends of the brand gradient carry the button text at 4.5:1", () => {
    expect(ratio(t["primary-foreground"]!, t["brand-deep"]!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t["primary-foreground"]!, t["brand-glow"]!)).toBeGreaterThanOrEqual(4.5);
  });
  it("control borders (inputs, selects, outline buttons) are at least 3:1 against every surface they sit on", () => {
    for (const s of surfaces) expect(ratio(t.input!, t[s]!)).toBeGreaterThanOrEqual(3);
  });
  it("the keyboard focus ring is at least 3:1 against every surface", () => {
    for (const s of surfaces) expect(ratio(t.ring!, t[s]!)).toBeGreaterThanOrEqual(3);
  });
  it("cards, menus and fields are visibly separate from the page (surface steps and a border)", () => {
    expect(ratio(t.card!, t.background!)).toBeGreaterThan(1.08);
    expect(ratio(t.border!, t.card!)).toBeGreaterThan(1.25);
    expect(t.raised).not.toBe(t.card);
    expect(t.chrome).not.toBe(t.background);
  });
});

describe("theme structure", () => {
  it("has exactly two themes: dark by default and data-theme=light", () => {
    expect(css).toMatch(/:root\s*\{/);
    expect(css).toMatch(/:root\[data-theme="light"\]\s*\{/);
    expect(css).not.toMatch(/data-theme="(?!light)[a-z]+"\]\s*\{/);
  });
  it("the dark variant follows the app's own theme attribute, not the OS setting", () => {
    expect(css).toContain("@custom-variant dark");
  });
  it("light surfaces are soft: no pure-white page, sidebar or cards", () => {
    const light = THEMES.light;
    for (const s of ["background", "chrome", "card"] as const) expect(parseFloat(light[s]!.split(/\s+/)[2]!)).toBeLessThan(98.5);
  });
});
