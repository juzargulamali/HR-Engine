import "server-only";
import { z } from "zod";
import { classifyRequest, EXCLUSION_MESSAGE } from "../classifier";
import { GUIDANCE, guidanceIndex, type GuidanceEntry } from "../help/guidance";
import { asksPurpose, hasSubject, matchByMeaning, screenGuides } from "../help/match";
import { approvedScreens, placesNamed, resolveScreen } from "../help/screens";
import { ABOUT_THIS_SCREEN } from "../router";
import type { HelpAnswerCard } from "../protocol";
import { JarvisRefusalError, type JarvisActionDefinition } from "../types";

export const HELP_ANSWER_ID = "jarvis.sales.help.answer";

// `screen`: the address path of the page the person is on, as the panel reports it. It is reduced to an approved screen identifier (help/screens.ts) before any use.
// `topicId`: the guide the person picked when asked which one they meant.
const inputSchema = z.object({ question: z.string().trim().min(1).max(1000), screen: z.string().max(2000).nullable().optional(), topicId: z.string().regex(/^[a-z][a-z0-9-]{2,60}$/).nullable().optional() });
export type HelpAnswerInput = z.infer<typeof inputSchema>;

const NOTE_GUIDANCE = "From the published Enginious OS guidance. Open the screens below to do it. If something here is wrong, suggest a correction.";
const NOTE_NONE = "There is no approved guidance for that yet, so I will not guess. These are the closest topics I can explain; for anything else, use the screen itself or ask the module's owner.";
const NOTE_CHOOSE = "More than one guide fits. Which do you mean?";
const AREA: { area: GuidanceEntry["area"]; re: RegExp }[] = [
  { area: "sales", re: /\b(?:sales|crm|enquir\w*|inquir\w*|follow-?ups?|clients?|agenc\w*|estimates?|proposals?|pipeline|zoho|events?|exhibitions?|outreach)\b/i },
  { area: "projects", re: /\b(?:projects?|tasks?|milestones?|handovers?)\b/i },
  { area: "inventory", re: /\b(?:inventory|warehouse|equipment|stock)\b/i },
  { area: "people", re: /\b(?:leave|attendance|clock|claims?|reimburse\w*|employees?|people|access|payroll)\b/i },
];
const MODULE_AREA: Record<string, GuidanceEntry["area"]> = { "Sales & CRM": "sales", Projects: "projects", "Projects & Tasks": "projects", Inventory: "inventory", "People & HR": "people", Me: "people", Finance: "finance" };

/**
 * How Enginious OS works. Answered ONLY from the published staff guidance of the Map (docs/enginious-os/staff-guidance, generated into lib/jarvis/knowledge), matched to
 * the question BY MEANING (help/match.ts) and to the approved identifier of the screen the person is on (help/screens.ts), preferring the most specific guide and asking one
 * short question when two fit equally: a direct answer with the steps and links to real screens. It reads no record and calls no provider. Where there is no approved guidance it says so and
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
    const done = (card: Omit<HelpAnswerCard, "kind">) => ({ values: input, target: { kind: "new" } as const, valid: false, card: { kind: "help.answer", ...card } as HelpAnswerCard });
    const view = (g: GuidanceEntry) => ({ id: g.id, title: g.title, summary: g.summary, steps: g.steps, links: g.links });
    // The current screen is a HINT about where the person is: only its approved identifier is used, only to choose guidance. No screen content or record is read.
    const screen = resolveScreen(input.screen ?? null);
    const index = guidanceIndex((s) => approvedScreens().get(s)?.label ?? null);
    if (input.topicId) {
      const chosen = GUIDANCE.find((g) => g.id === input.topicId);
      if (chosen) return done({ mode: "guidance", topics: [], note: NOTE_GUIDANCE, entries: [view(chosen)] });
    }
    const aboutHere = ABOUT_THIS_SCREEN.test(input.question);
    // "What is the benefit here?", "what is this for?": the guide is given as what the feature helps staff do. Grounded in the guide; nothing is made up.
    const purpose = asksPurpose(input.question);
    const lead = (g: GuidanceEntry, onScreen: boolean) => (purpose ? `What ${onScreen && screen ? screen.label : g.title} helps you do` : null);
    const answer = (entries: GuidanceEntry[], forScreen: boolean) => {
      // The most specific guide is given in full; when one screen has several, the rest are listed by title to pick from.
      const [first, ...rest] = entries;
      return done({ mode: "guidance", topics: [], note: NOTE_GUIDANCE, screen: forScreen ? { label: screen!.label } : null, lead: lead(first!, forScreen), entries: rest.length > 1 ? [view(first!)] : entries.map(view), choices: rest.length > 1 ? rest.map((g) => ({ id: g.id, title: g.title })) : [], question: input.question });
    };
    const m = matchByMeaning(index, input.question, screen?.id ?? null);
    // An explicit question about something (this screen or another) is answered by the guide that fits it.
    if (m.kind === "answer") return answer(m.entries, !!screen && m.entries.some((g) => g.screens?.includes(screen.id)) && (aboutHere || purpose || m.score >= 1));
    // Nothing fits on its own, but the person is asking about the screen they are on (or what it is for) and that screen HAS a published guide: that guide is the answer.
    // "No approved guidance" is said only when there really is none.
    const here = screenGuides(index, screen?.id ?? null);
    if (here.length > 0 && (aboutHere || purpose || !hasSubject(input.question))) return answer(here.slice(0, 4), true);
    if (m.kind === "ambiguous") return done({ mode: "choose", entries: [], topics: [], note: NOTE_CHOOSE, choices: m.options.map((g) => ({ id: g.id, title: g.title })), question: input.question });
    // Nothing fits. Say so honestly: name the screen if that was the question, offer the navigation's own entries the question named, and the closest topics.
    const places = placesNamed(input.question).map((p) => ({ label: p.module && p.module !== p.label ? `${p.label} (${p.module})` : p.label, href: p.href }));
    if (aboutHere && !screen) return done({ mode: "no_guidance", entries: [], topics: [], places: [], note: "I cannot tell which screen you are on. Name it (for example \"What can I do in Events & Exhibitions?\") and I will explain it." });
    const area = (screen?.module ? MODULE_AREA[screen.module] : undefined) ?? AREA.find((a) => a.re.test(input.question))?.area;
    const near = (area ? GUIDANCE.filter((g) => g.area === area) : GUIDANCE.filter((g) => /-overview$|-where$|^my-day$|^jarvis-about$/.test(g.id))).slice(0, 8);
    return done({
      mode: "no_guidance", entries: [], places, topics: near.map((g) => ({ id: g.id, title: g.title })), screen: aboutHere && screen ? { label: screen.label } : null,
      note: aboutHere && screen ? `There is no approved guidance for ${screen.label} yet, so I will not guess what it does. These are the closest topics I can explain.` : places.length > 0 ? "There is no written guide for that yet, but these screens have that name. If you do not see one in the menu, you do not have access to it." : NOTE_NONE,
    });
  },
};
