import "server-only";
import { z } from "zod";
import { classifyRequest, EXCLUSION_MESSAGE } from "../classifier";
import { GUIDANCE, matchGuidance, type GuidanceEntry } from "../help/guidance";
import type { HelpAnswerCard } from "../protocol";
import { JarvisRefusalError, type JarvisActionDefinition } from "../types";

export const HELP_ANSWER_ID = "jarvis.sales.help.answer";

const inputSchema = z.object({ question: z.string().trim().min(1).max(1000) });
export type HelpAnswerInput = z.infer<typeof inputSchema>;

const NOTE_GUIDANCE = "From the published Enginious OS guidance. Open the screens below to do it. If something here is wrong, suggest a correction.";
const NOTE_NONE = "There is no approved guidance for that yet, so I will not guess. These are the closest topics I can explain; for anything else, use the screen itself or ask the module's owner.";
const AREA: { area: GuidanceEntry["area"]; re: RegExp }[] = [
  { area: "sales", re: /\b(?:sales|crm|enquir\w*|inquir\w*|follow-?ups?|clients?|agenc\w*|estimates?|proposals?|pipeline|zoho)\b/i },
  { area: "projects", re: /\b(?:projects?|tasks?|milestones?|handovers?)\b/i },
  { area: "inventory", re: /\b(?:inventory|warehouse|equipment|stock)\b/i },
  { area: "people", re: /\b(?:leave|attendance|clock|claims?|reimburse\w*|employees?|people|access|payroll)\b/i },
];

/**
 * How Enginious OS works. Answered ONLY from the published staff guidance of the Map (docs/enginious-os/staff-guidance, generated into lib/jarvis/knowledge), chosen by a
 * deterministic match: a direct answer with the steps and links to real screens. It reads no record and calls no provider. Where there is no approved guidance it says so and
 * offers the closest topics instead of guessing. General (non-app) questions are not handled here: the router sends those to the general chat.
 */
export const helpAnswer: JarvisActionDefinition<HelpAnswerInput, HelpAnswerInput, HelpAnswerCard, never> = {
  id: HELP_ANSWER_ID,
  module: "sales",
  title: "Explain how Enginious OS works",
  description: "Ask how something works (for example \"How does Sales & CRM work?\" or \"How do I log a follow-up?\"). JARVIS answers with the steps from the published guidance and links to the screens. Sales & CRM is covered in detail; other modules have \"where to find it\" guidance only.",
  risk: "read",
  requires: { moduleGrant: "sales" },
  status: { enabled: true },
  usesProvider: false,
  inputSchema,
  valuesSchema: inputSchema,
  describe: () => "Answer a question (reads nothing)",
  async propose(_ctx, input) {
    if (!classifyRequest(input.question, { howTo: true }).allowed) throw new JarvisRefusalError("excluded_request", EXCLUSION_MESSAGE);
    const matched = matchGuidance(input.question);
    const done = (card: Omit<HelpAnswerCard, "kind">) => ({ values: input, target: { kind: "new" } as const, valid: false, card: { kind: "help.answer", ...card } as HelpAnswerCard });
    if (matched.length > 0) return done({ mode: "guidance", topics: [], note: NOTE_GUIDANCE, entries: matched.map((g) => ({ id: g.id, title: g.title, summary: g.summary, steps: g.steps, links: g.links })) });
    const area = AREA.find((a) => a.re.test(input.question))?.area;
    const near = (area ? GUIDANCE.filter((g) => g.area === area) : GUIDANCE.filter((g) => /-overview$|-where$|^my-day$|^jarvis-about$/.test(g.id))).slice(0, 8);
    return done({ mode: "no_guidance", entries: [], note: NOTE_NONE, topics: near.map((g) => ({ id: g.id, title: g.title })) });
  },
};
