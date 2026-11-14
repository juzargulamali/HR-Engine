"use client";

import { useEffect } from "react";

/** The id a follow-up's row carries on the Follow-ups page, so a link with `?focus=<id>` can be scrolled to. */
export const followUpRowId = (id: string) => `follow-up-${id}`;

/**
 * Brings the follow-up named in the address (`?focus=<id>`, from a reminder or from My Day) into view. The row is already marked in words and colour by
 * the server; this only scrolls to it. It stands aside when the person is coming back through a "back" link, because RememberList (rendered after this,
 * so its effect runs after) is then about to put them where they were, which is the better place.
 */
export function FocusRow({ id }: { id: string }) {
  useEffect(() => {
    let returning = false;
    try { returning = sessionStorage.getItem("os-list:follow-ups:restore") === "1"; } catch { /* storage blocked: scroll to the row */ }
    if (returning) return;
    document.getElementById(followUpRowId(id))?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [id]);
  return null;
}
