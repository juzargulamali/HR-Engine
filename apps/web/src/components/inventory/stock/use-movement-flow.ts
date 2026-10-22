"use client";

import { useCallback, useRef, useState } from "react";
import { isUncertain } from "@/lib/inventory/action-utils";
import { newMovementKey } from "@/lib/inventory/idempotency";
import type { MovementInput } from "@/lib/inventory/stock-movements";
import type { MovementOutcome } from "@/lib/actions/inventoryStock";
import type { MovementServices } from "./movement-services";

export type FlowPhase = "editing" | "reviewing" | "sending" | "done";

export interface CheckResult { state: "recorded" | "not_recorded" | "in_progress" | "unknown" | "error"; text: string }

/**
 * The honest-saving state of one movement form.
 *
 *  - ONE key is made when the form opens and is sent with every attempt: the database returns the first result for the same key and the
 *    same content, so a repeated click, a retry, or a repeat after a lost connection can never record twice.
 *  - Confirm is a single flight: while a request is out, another click does nothing at all.
 *  - A failure never clears the form. When it is uncertain (time ran out, the connection dropped) the form is locked as it is and offers
 *    "Check whether it went through" before anything is sent again.
 *  - Success is shown only after the database said so.
 */
export function useMovementFlow(services: Pick<MovementServices, "submit" | "check">, companyId: string, prefix = "mv") {
  const [key, setKey] = useState(() => newMovementKey(prefix));
  const [phase, setPhase] = useState<FlowPhase>("editing");
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [outcome, setOutcome] = useState<MovementOutcome | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);
  const checkingRef = useRef(false);

  const toReview = useCallback(() => { setError(null); setPhase("reviewing"); }, []);
  const toEdit = useCallback(() => { if (!inFlight.current) { setError(null); setPhase("editing"); } }, []);

  /** Sends the request. Ignored while another one is out. `build` is called once, at the moment of sending, with the key. */
  const confirm = useCallback(async (build: (key: string) => MovementInput) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("sending");
    setError(null);
    setCheck(null);
    try {
      const res = await services.submit(build(key));
      if (res.error) {
        setError(res.error);
        setUncertain(!!res.uncertain || isUncertain(res.error));
        setPhase("reviewing");
      } else {
        setUncertain(false);
        setOutcome(res);
        setPhase("done");
      }
    } catch {
      // The request itself failed to complete (connection lost): we do not know whether the server recorded it.
      setError("We could not confirm whether this was recorded: the connection was lost. Use “Check whether it went through” before trying again; the same entry cannot be recorded twice.");
      setUncertain(true);
      setPhase("reviewing");
    } finally {
      inFlight.current = false;
    }
  }, [services, key]);

  /** Asks the database what became of this key. Changes nothing. */
  const runCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    try {
      const res = await services.check(companyId, key);
      if (res.error) setCheck({ state: "error", text: res.error });
      else {
        setCheck({ state: res.state ?? "unknown", text: res.text ?? "" });
        // It did go through: show it as done, never as a failure.
        if (res.state === "recorded") {
          setOutcome({ error: null, message: res.text });
          setUncertain(false);
          setError(null);
          setPhase("done");
        }
      }
    } catch {
      setCheck({ state: "error", text: "The check could not be done right now. Do not send the entry again yet; try the check again in a moment." });
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [services, companyId, key]);

  /** A new entry with a new key. Only for after a result check said the first one was not recorded, or after a success. */
  const startNew = useCallback(() => {
    setKey(newMovementKey(prefix));
    setPhase("editing");
    setError(null);
    setUncertain(false);
    setOutcome(null);
    setCheck(null);
  }, [prefix]);

  return { key, phase, error, uncertain, outcome, check, checking, toReview, toEdit, confirm, runCheck, startNew };
}
