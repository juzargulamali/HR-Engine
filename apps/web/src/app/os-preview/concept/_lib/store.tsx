"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { withParams } from "@/components/workspace/url-state";
import {
  EQUIPMENT, MESSAGES, PEOPLE, PERSONAS, TASKS, personName,
  type EquipmentLine, type Message, type Persona, type Task, type TaskStatus, type TeamId,
} from "./sample";
import { canAddTask, canAssign, canEditStatus, canManageTask, statusRefusal } from "./logic";

/**
 * The concept's only state: a copy of the sample records held in memory. Every "save" is a short pause followed by a change to that
 * copy, so a person can see saving, saved and failed states. Nothing here calls the network, a server action or a database, and a
 * reload puts the sample back (the banner says so). Kept at the layout so it survives moving between the list and a project.
 */
export interface Toast { id: number; tone: "saving" | "saved" | "error" | "info"; text: string; retry?: () => void }
export interface NewTask { projectId: string; title: string; assignee: string | null; due: string; team: TeamId; description: string }

interface Concept {
  persona: Persona;
  setPersona: (id: string) => void;
  /** An address inside the concept that keeps the chosen "Preview as" person. */
  href: (path: string, patch?: Record<string, string | null | undefined>) => string;
  tasks: Task[];
  messages: Message[];
  lines: EquipmentLine[];
  toast: Toast | null;
  dismissToast: () => void;
  notify: (tone: "info" | "error", text: string) => void;
  failNext: boolean;
  setFailNext: (v: boolean) => void;
  /** Where the Projects list was left, so coming back finds the same filters, view and scroll position. */
  getListMemory: () => { query: string; scroll: number; last: string };
  rememberList: (m: { query: string; scroll: number; last: string }) => void;
  /** The project opened last from the list (its row is marked when the list comes back) and the list's filters at that moment. */
  lastOpened: string;
  listQuery: string;
  /** Lets a reviewer see the loading and error states of the workspace without waiting for a real failure. */
  forced: "none" | "loading" | "error";
  setForced: (v: "none" | "loading" | "error") => void;
  setStatus: (taskId: string, to: TaskStatus, note?: string) => Promise<boolean>;
  setAssignee: (taskId: string, assignee: string | null) => Promise<boolean>;
  setBlocked: (taskId: string, reason: string | null) => Promise<boolean>;
  toggleCheck: (taskId: string, itemId: string) => Promise<boolean>;
  addComment: (taskId: string, text: string) => Promise<boolean>;
  addTask: (t: NewTask) => Promise<string | null>;
  addMessage: (projectId: string, text: string, opts?: { replyTo?: string; taskId?: string }) => Promise<boolean>;
  addEquipmentRequest: (projectId: string, item: string, qty: number) => Promise<boolean>;
  resetSample: () => void;
}

const Ctx = createContext<Concept | null>(null);
export function useConcept(): Concept {
  const c = useContext(Ctx);
  if (!c) throw new Error("useConcept must be used inside ConceptProvider");
  return c;
}

const SAVE_MS = 450;
const NOW_LABEL = "Mon 26 Oct";

export function ConceptProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const personaParam = sp.get("as") ?? "";
  const persona = PERSONAS.find((p) => p.id === personaParam) ?? PERSONAS[0]!;

  const [tasks, setTasks] = useState<Task[]>(TASKS);
  const [messages, setMessages] = useState<Message[]>(MESSAGES);
  const [lines, setLines] = useState<EquipmentLine[]>(EQUIPMENT);
  const [toast, setToast] = useState<Toast | null>(null);
  const [failNext, setFailNext] = useState(false);
  const failRef = useRef(false);
  const tasksRef = useRef(tasks);
  const personaRef = useRef(persona);
  // The save timers and the actions below read the latest values from these refs (they run later than the render that created them).
  useEffect(() => { failRef.current = failNext; tasksRef.current = tasks; personaRef.current = persona; });
  const seq = useRef(0);
  const counter = useRef(0);
  const memory = useRef({ query: "", scroll: 0, last: "" });
  const [listState, setListState] = useState({ last: "", query: "" });
  const [forced, setForced] = useState<"none" | "loading" | "error">("none");

  // A message stays up long enough to read; a failure stays until it is dismissed or retried.
  useEffect(() => {
    if (!toast || toast.tone === "error" || toast.tone === "saving") return;
    const t = window.setTimeout(() => setToast((cur) => (cur && cur.id === toast.id ? null : cur)), toast.tone === "saved" ? 3500 : 8000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const notify = useCallback((tone: "info" | "error", text: string) => setToast({ id: ++seq.current, tone, text }), []);

  const run = useCallback((label: string, apply: () => void): Promise<boolean> => {
    const attempt = (): Promise<boolean> => new Promise((resolve) => {
      const id = ++seq.current;
      setToast({ id, tone: "saving", text: `Saving ${label}…` });
      window.setTimeout(() => {
        if (failRef.current) {
          setFailNext(false);
          setToast({ id, tone: "error", text: `${label} was not saved. This failure was simulated from Preview options. Nothing changed.`, retry: () => { void attempt(); } });
          resolve(false);
          return;
        }
        apply();
        setToast({ id, tone: "saved", text: `Saved ${label}. Sample data: this stays in this browser tab.` });
        resolve(true);
      }, SAVE_MS);
    });
    return attempt();
  }, []);

  const find = (id: string) => tasksRef.current.find((t) => t.id === id) ?? null;
  const patchTask = (id: string, fn: (t: Task) => Task) => setTasks((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  const event = (text: string, kind: "event" | "comment" = "event") => ({ id: `ev-${++counter.current}`, who: personaRef.current.personId ?? "someone", at: NOW_LABEL, text, kind });

  const api = useMemo<Concept>(() => ({
    persona,
    setPersona: (id) => router.replace(withParams(pathname, sp, { as: id === PERSONAS[0]!.id ? null : id }), { scroll: false }),
    href: (path, patch = {}) => withParams(path, personaParam ? { as: personaParam } : {}, patch),
    tasks, messages, lines, toast, dismissToast: () => setToast(null), notify, failNext, setFailNext, forced, setForced,
    getListMemory: () => memory.current,
    rememberList: (m) => { memory.current = m; setListState({ last: m.last, query: m.query }); },
    lastOpened: listState.last,
    listQuery: listState.query,

    setStatus: async (taskId, to, note) => {
      const t = find(taskId);
      if (!t) return false;
      const refusal = statusRefusal(personaRef.current, t, to);
      if (refusal) { notify("info", refusal); return false; }
      const label = TASK_STATUS_WORDS[to];
      return run(`"${t.title}" as ${label}`, () => patchTask(taskId, (x) => ({
        ...x, status: to,
        submittedBy: to === "review" ? (x.assignee ?? personaRef.current.personId ?? undefined) : x.submittedBy,
        activity: [...x.activity, event(note ?? `Moved to ${label}`)],
      })));
    },
    setAssignee: async (taskId, assignee) => {
      const t = find(taskId);
      if (!t) return false;
      if (!canAssign(personaRef.current, t)) { notify("info", "Only the Project Manager or the head of the team assigns work."); return false; }
      return run(`the assignee of "${t.title}"`, () => patchTask(taskId, (x) => ({ ...x, assignee, activity: [...x.activity, event(assignee ? `Assigned to ${personName(assignee)}` : "Made unassigned")] })));
    },
    setBlocked: async (taskId, reason) => {
      const t = find(taskId);
      if (!t) return false;
      const me = personaRef.current;
      const mayUnblock = canManageTask(me, t) || me.personId === t.blocked?.unblocker;
      if (reason === null && !mayUnblock) { notify("info", "The person named to unblock it, a head or the Project Manager marks a blocker resolved."); return false; }
      if (reason !== null && !canEditStatus(me, t)) { notify("info", "You can only mark your own tasks as blocked."); return false; }
      return run(reason === null ? `the blocker on "${t.title}" as resolved` : `"${t.title}" as blocked`, () => patchTask(taskId, (x) => ({
        ...x,
        blocked: reason === null ? null : { reason, unblocker: PEOPLE.find((p) => p.team === x.team && p.role.startsWith("Head"))?.id ?? "layla", since: NOW_LABEL },
        activity: [...x.activity, event(reason === null ? "Blocker resolved" : `Blocked: ${reason}`)],
      })));
    },
    toggleCheck: async (taskId, itemId) => {
      const t = find(taskId);
      if (!t) return false;
      if (!canEditStatus(personaRef.current, t)) { notify("info", "Only the person doing the task, or a manager, ticks its checklist."); return false; }
      return run("the checklist", () => patchTask(taskId, (x) => ({ ...x, checklist: x.checklist.map((c) => (c.id === itemId ? { ...c, done: !c.done } : c)) })));
    },
    addComment: async (taskId, text) => run("your comment", () => patchTask(taskId, (x) => ({ ...x, activity: [...x.activity, event(text, "comment")] }))),
    addTask: async (n) => {
      if (!canAddTask(personaRef.current)) { notify("info", "A directory-only colleague cannot add tasks."); return null; }
      const id = `n${++counter.current}`;
      const ok = await run(`the task "${n.title}"`, () => setTasks((prev) => [...prev, {
        id, projectId: n.projectId, title: n.title, description: n.description, assignee: n.assignee, status: "todo", due: n.due, milestoneId: null, team: n.team,
        needsReview: false, blocked: null, checklist: [], activity: [event("Task added (sample)")], createdLocally: true,
      }]));
      return ok ? id : null;
    },
    addMessage: async (projectId, text, opts) => run("your message", () => setMessages((prev) => [...prev, {
      id: `m-${++counter.current}`, projectId, who: personaRef.current.personId ?? "someone", at: `${NOW_LABEL}, now`, text, replyTo: opts?.replyTo, taskId: opts?.taskId,
    }])),
    addEquipmentRequest: async (projectId, item, qty) => run("the equipment request draft", () => setLines((prev) => [...prev, {
      id: `q-${++counter.current}`, projectId, item, requested: qty, reserved: 0, dispatched: 0, returned: 0, draft: true,
    }])),
    resetSample: () => { setTasks(TASKS); setMessages(MESSAGES); setLines(EQUIPMENT); setToast(null); setFailNext(false); setForced("none"); },
  }), [persona, personaParam, pathname, sp, router, tasks, messages, lines, toast, failNext, forced, listState, run, notify]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

const TASK_STATUS_WORDS: Record<TaskStatus, string> = { todo: "To do", doing: "In progress", review: "In review", done: "Done" };
