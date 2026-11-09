import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_QUESTION, GUIDANCE, matchGuidance } from "./guidance";

/** The page routes of the app, from the folders: (groups) do not appear in the URL, [params] match anything. */
function routes(): string[] {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../app");
  const out: string[] = [];
  const walk = (dir: string, url: string[]) => {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) walk(p, /^\(.*\)$/.test(f) ? url : [...url, f]);
      else if (f === "page.tsx") out.push(`/${url.join("/")}`);
    }
  };
  walk(root, []);
  return out;
}

describe("reviewed guidance", () => {
  it("every link goes to a real screen of the app (a page route exists for it), and ids are unique", () => {
    const known = routes();
    expect(known.length).toBeGreaterThan(50);
    expect(new Set(GUIDANCE.map((g) => g.id)).size).toBe(GUIDANCE.length);
    for (const g of GUIDANCE) for (const l of g.links) {
      const p = l.href.split("?")[0]!;
      expect(l.href.startsWith("/"), l.href).toBe(true);
      expect(known.some((r) => r === p || new RegExp(`^${r.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(p)), `${g.id}: no page for ${l.href}`).toBe(true);
    }
  });
  it("is staff-facing: no code paths, SQL, migration names, table or function names, or permission internals", () => {
    const text = JSON.stringify(GUIDANCE.map(({ keywords: _k, ...visible }) => visible));
    expect(text).not.toMatch(/\.tsx?\b|\.sql\b|migration|\bsql\b|\brls\b|\bcrm_[a-z_]+|\bjarvis_[a-z_]+|supabase|apps\/web|packages\/|server action|\/api\/|security definer|row.level|\bgrants?\b|capabilit|assign_owner|service.role|catalogue|app map|ledger|HMAC|confirmation token/i);
    for (const g of GUIDANCE) {
      expect(g.summary.length, g.id).toBeLessThanOrEqual(520);
      expect(g.steps.length, g.id).toBeLessThanOrEqual(5);
      expect(g.title.length, g.id).toBeGreaterThan(3);
    }
  });
  it("matches plain questions to the right topic, and nothing for questions it has no guidance for", () => {
    expect(matchGuidance("How do I log a follow-up?")[0]?.id).toBe("sales-follow-ups");
    expect(matchGuidance("how do I add an enquiry")[0]?.id).toBe("sales-add-enquiry");
    expect(matchGuidance("how do I request leave")[0]?.id).toBe("people-leave");
    expect(matchGuidance("where do I find equipment requests")[0]?.id).toBe("inventory-where");
    expect(matchGuidance("what is the capital of France")).toEqual([]);
    expect(matchGuidance("")).toEqual([]);
    expect(matchGuidance("xyzzy plugh")).toEqual([]);
  });
  it("recognises questions about the app", () => {
    for (const q of ["How do I reopen an enquiry?", "where is the payslip page", "what does the login button do", "can jarvis do inventory"]) expect(APP_QUESTION.test(q), q).toBe(true);
    expect(APP_QUESTION.test("What is the capital of France?")).toBe(false);
  });
});
