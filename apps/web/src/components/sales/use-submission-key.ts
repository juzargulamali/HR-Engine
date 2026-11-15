"use client";

import { useEffect, useState } from "react";

/** A random version-4 identifier. `crypto.randomUUID` needs a secure page; the fallback builds the same shape from `crypto.getRandomValues`. */
export function newSubmissionKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * The submission identifier of ONE opened enquiry form. It is made once, when the form appears in the browser, and sent with every attempt to save that form, so
 * the database can tell "the same save again" (a retry after the answer was lost, a double click: it returns the enquiry already saved) from "another enquiry"
 * (a form opened again has a new identifier). Empty until the form is in the browser: it is never made on the server, where every visitor would share the page's
 * cached copy. The form puts it in a hidden field named `submissionKey` only when it is set.
 */
export function useSubmissionKey(): string {
  const [key, setKey] = useState("");
  // eslint-disable-next-line react-hooks/set-state-in-effect -- made in the browser only, once, after the form is on screen
  useEffect(() => { setKey(newSubmissionKey()); }, []);
  return key;
}
