import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAnthropicProvider } from "./provider/anthropic";
import { createSimulatedProvider, simulatedProviderCalls } from "./provider/simulated";
import { JarvisProviderError, type StructuredRequest } from "./provider/types";
import { EXTRACTION_INSTRUCTIONS, EXTRACTION_JSON_SCHEMA, EXTRACTION_TASK, sanitiseExtraction } from "./sales/extraction";

const req: StructuredRequest = { task: EXTRACTION_TASK, instructions: EXTRACTION_INSTRUCTIONS, input: "Agency: Fictional Wave Agency\nClient: Fictional Harbour Brands", jsonSchema: EXTRACTION_JSON_SCHEMA, maxOutputTokens: 777, timeoutMs: 5000 };
const KEY = "sk-ant-fictional-test-key-0000";

const ok = (input: unknown) => new Response(JSON.stringify({ content: [{ type: "text", text: "..." }, { type: "tool_use", name: "record_fields", input }] }), { status: 200 });

describe("Anthropic provider (plain fetch, no network in tests)", () => {
  it("sends the configured model, the cap, ONE tool with tool_choice auto, the brief inside <brief> tags and the key only in the header", async () => {
    const f = vi.fn(async () => ok({ title: "x" }));
    const p = createAnthropicProvider({ apiKey: KEY, model: "claude-sonnet-5-5", fetchImpl: f as unknown as typeof fetch });
    expect(await p.structured(req)).toEqual({ title: "x" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe(KEY);
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "claude-sonnet-5-5", max_tokens: 777, tool_choice: { type: "auto" } });
    expect(body.tools).toHaveLength(1);
    expect(body.messages).toEqual([{ role: "user", content: `<brief>\n${req.input}\n</brief>` }]);
    expect(body.system).toContain("untrusted");
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
  it("maps timeouts, network failures, HTTP errors and malformed answers to typed errors that never carry the key or the body", async () => {
    const mk = (f: typeof fetch) => createAnthropicProvider({ apiKey: KEY, model: "m", fetchImpl: f }).structured(req);
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    await expect(mk((async () => { throw timeout; }) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "timeout" });
    await expect(mk((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "network" });
    const http = await mk((async () => new Response(`{"error":"bad key ${KEY} secret body"}`, { status: 401 })) as unknown as typeof fetch).catch((e) => e as JarvisProviderError);
    expect(http).toMatchObject({ kind: "http", status: 401 });
    expect(String((http as Error).message)).not.toContain(KEY);
    expect(String((http as Error).message)).not.toContain("secret body");
    await expect(mk((async () => new Response("not json", { status: 200 })) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "malformed" });
    await expect(mk((async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hi" }] }), { status: 200 })) as unknown as typeof fetch)).rejects.toMatchObject({ kind: "malformed" });
  });
});

describe("model output is data: pruned and validated", () => {
  it("keeps only the known keys; drops execute flags, company/org/owner ids and roles; blanks invalid values", () => {
    const out = sanitiseExtraction({
      title: "  LED wall  ", source: "whatsapp", agencyName: "Fictional Wave Agency", clientName: 42, currency: "aed", value: 45000, eventStart: "2026-12-05", eventEnd: "2026-13-45",
      technologies: [{ name: "LED wall", qty: 2 }, { name: "", qty: 1 }, { name: "x", qty: 0 }], waitingOn: "someone", nextKind: "call",
      execute: true, confirmed: true, grantAdmin: true, role: "admin", companyId: "x", agencyOrgId: "a", clientOrgId: "b", ownerId: "c", showPayroll: true,
    }) as unknown as Record<string, unknown>;
    expect(out).toMatchObject({ title: "LED wall", source: "whatsapp", agencyName: "Fictional Wave Agency", clientName: null, currency: "AED", value: 45000, eventStart: "2026-12-05", eventEnd: null, waitingOn: null, nextKind: "call" });
    expect(out.technologies).toEqual([{ name: "LED wall", qty: 2 }]);
    for (const k of ["execute", "confirmed", "grantAdmin", "role", "companyId", "agencyOrgId", "clientOrgId", "ownerId", "showPayroll"]) expect(out).not.toHaveProperty(k);
  });
  it("length-limits strings, rejects unknown sources and survives garbage", () => {
    const out = sanitiseExtraction({ title: "x".repeat(500), source: "carrier_pigeon", briefSummary: "y".repeat(5000), location: "z".repeat(1000) });
    expect(out.title).toBeNull();
    expect(out.source).toBeNull();
    expect(out.briefSummary).toBeNull();
    expect(out.location).toBeNull();
    for (const g of [null, undefined, 5, "str", [], [1, 2]]) expect(sanitiseExtraction(g)).toMatchObject({ title: null, source: null, technologies: [] });
  });
});

describe("simulated provider", () => {
  it("extracts labelled fields deterministically and records exactly what it was sent", async () => {
    simulatedProviderCalls.length = 0;
    const p = createSimulatedProvider();
    const out = (await p.structured({ ...req, input: "Title: Harbour gala LED wall\nAgency: Fictional Wave Agency\nClient: Fictional Harbour Brands\nSource: WhatsApp\nEvent: 2026-12-05 to 2026-12-07\nBudget: AED 45,000\nTech: LED wall x2, Touch table\nNext: Call to qualify on 2026-11-12" })) as Record<string, unknown>;
    expect(out).toMatchObject({ title: "Harbour gala LED wall", agencyName: "Fictional Wave Agency", clientName: "Fictional Harbour Brands", source: "whatsapp", eventStart: "2026-12-05", eventEnd: "2026-12-07", currency: "AED", value: 45000, nextTitle: "Call to qualify", nextDate: "2026-11-12", nextKind: "call" });
    expect(out.technologies).toEqual([{ name: "LED wall", qty: 2 }, { name: "Touch table", qty: 1 }]);
    expect(simulatedProviderCalls).toHaveLength(1);
    expect(Object.keys(simulatedProviderCalls[0]!).sort()).toEqual(["input", "instructions", "jsonSchema", "maxOutputTokens", "task", "timeoutMs"]);
  });
  it("fails on request (for the provider-error tests)", async () => {
    await expect(createSimulatedProvider().structured({ ...req, input: "[[provider-error]]" })).rejects.toMatchObject({ kind: "http" });
    await expect(createSimulatedProvider().structured({ ...req, input: "[[provider-timeout]]" })).rejects.toMatchObject({ kind: "timeout" });
  });
});
