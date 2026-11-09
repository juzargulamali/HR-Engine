/**
 * The estimate editor's work queue (client side, no React): everything that changes the saved draft goes through here, one step at a time, so overlapping
 * saves, section adds and picture attaches can never create a second copy of an item or a section.
 *
 *  - `save()` asks for a save. Asks made while a save is still WAITING (with no step queued after it) are folded into it (one request, not a pile); an ask made while a save is RUNNING
 *    queues exactly one more, which runs after it and so includes the edits made meanwhile. Every caller gets the outcome of the save that covers its ask.
 *  - `exclusive(task)` runs a server-changing step (add a section, attach a picture, delete an item) after the work already queued and before anything queued later.
 *  - `track(promise)` registers a slow transfer that is not exclusive (the picture upload itself), so "wait until everything is done" also waits for it.
 *  - `idle()` resolves when no save, step or upload is running or waiting, with the outcome of the latest save.
 */
export type SaveOutcome =
  | { ok: true; /** Items that were kept on screen but could not be saved yet (incomplete): a sentence, or null. */ attention: string | null }
  | { ok: false; message: string };

export interface SaveQueue {
  save(): Promise<SaveOutcome>;
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  track<T>(work: Promise<T>): Promise<T>;
  idle(): Promise<SaveOutcome>;
  /** True while anything is running or waiting. */
  readonly busy: boolean;
  /** The outcome of the latest save that ran (ok before the first one). */
  readonly last: SaveOutcome;
  subscribe(listener: () => void): () => void;
}

const DID_NOT_RUN = "The save could not be completed. Your changes are still here; try again.";

export function createSaveQueue(runSave: () => Promise<SaveOutcome>): SaveQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let waitingSave: Promise<SaveOutcome> | null = null;
  let active = 0;
  let last: SaveOutcome = { ok: true, attention: null };
  const uploads = new Set<Promise<unknown>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    active += 1;
    notify();
    // The count drops BEFORE the caller's promise settles, so `busy` is already false when `await save()` returns.
    const result = tail.then(async () => {
      try { return await task(); } finally { active -= 1; notify(); }
    });
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const save = (): Promise<SaveOutcome> => {
    if (waitingSave) return waitingSave;
    const p: Promise<SaveOutcome> = enqueue(async () => {
      if (waitingSave === p) waitingSave = null;   // from here on a new ask belongs to the NEXT run (it must include edits made while this one runs)
      try { last = await runSave(); } catch { last = { ok: false, message: DID_NOT_RUN }; }
      return last;
    });
    waitingSave = p;
    return p;
  };

  return {
    save,
    // A step queued after a waiting save closes it: an ask made after the step belongs behind the step (it may depend on what the step changed).
    exclusive: (task) => { waitingSave = null; return enqueue(task); },
    track: (work) => {
      uploads.add(work);
      active += 1;
      notify();
      const done = () => { uploads.delete(work); active -= 1; notify(); };
      work.then(done, done);
      return work;
    },
    async idle() {
      // Loop: finishing one thing can start another (a save that was asked for while an upload finished).
      for (;;) {
        await Promise.allSettled([tail, ...uploads]);
        if (active === 0) return last;
        await Promise.resolve();
      }
    },
    get busy() { return active > 0; },
    get last() { return last; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
