"use client";

import { useEffect } from "react";

/**
 * One small store of "this form has edits that are not saved yet". Anything that would throw those edits away (closing the side
 * panel, opening another record, leaving the page) asks `confirmDiscard()` first. A plain module, not React context, because
 * the list rows that switch records and the panel that holds the form are separate parts of the page.
 */
const dirty = new Set<string>();

export const hasUnsavedChanges = (): boolean => dirty.size > 0;

export function setDirty(key: string, isDirty: boolean): void {
  if (isDirty) dirty.add(key);
  else dirty.delete(key);
}

export const DISCARD_MESSAGE = "You have changes that are not saved. Leave without saving them?";

/** True when nothing is unsaved, or the person agreed to discard it (the store is then cleared). */
export function confirmDiscard(message: string = DISCARD_MESSAGE): boolean {
  if (dirty.size === 0) return true;
  if (typeof window === "undefined" || window.confirm(message)) {
    dirty.clear();
    return true;
  }
  return false;
}

/** Registers a form's dirty state for as long as it is mounted; also warns before the tab is closed or reloaded. */
export function useUnsavedChanges(key: string, isDirty: boolean): void {
  useEffect(() => {
    setDirty(key, isDirty);
    return () => setDirty(key, false);
  }, [key, isDirty]);
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);
}
