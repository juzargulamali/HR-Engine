import { STALE_AFTER_MS } from "./model";
import type { TvBoard, TvFailureKind } from "./types";

/**
 * The refresh state machine of the board. One request at a time; a transient failure keeps the last good board marked stale; session expiry, sign-out, access loss or revocation CLEARS the board.
 * Pure: the page feeds it results and a clock.
 */
export type TvStatus = "loading" | "ok" | "stale" | "error" | "denied" | "revoked" | "signed_out" | "not_installed";
export interface TvRefreshState { status: TvStatus; board: TvBoard | null; lastOkAt: number | null; inFlight: boolean; failures: number }
export type TvResult = { kind: "ok"; board: TvBoard } | { kind: TvFailureKind };
export type TvAction = { type: "start" } | { type: "result"; result: TvResult; at: number } | { type: "tick"; now: number };

export const initialRefresh: TvRefreshState = { status: "loading", board: null, lastOkAt: null, inFlight: false, failures: 0 };
/** Do not start a request while one is running, or once access is gone (the page then offers sign-in instead). */
export const canStart = (s: TvRefreshState): boolean => !s.inFlight && !CLEARED.includes(s.status);
const CLEARED: TvStatus[] = ["denied", "revoked", "signed_out", "not_installed"];
export const isCleared = (s: TvStatus): boolean => CLEARED.includes(s);

export function refreshReducer(s: TvRefreshState, a: TvAction): TvRefreshState {
  switch (a.type) {
    case "start": return s.inFlight ? s : { ...s, inFlight: true };
    case "tick":
      return s.status === "ok" && s.lastOkAt !== null && a.now - s.lastOkAt > STALE_AFTER_MS ? { ...s, status: "stale" } : s;
    case "result": {
      const r = a.result;
      if (r.kind === "ok") return { status: "ok", board: r.board, lastOkAt: a.at, inFlight: false, failures: 0 };
      if (r.kind === "transient") return s.board ? { ...s, status: "stale", inFlight: false, failures: s.failures + 1 } : { ...s, status: "error", inFlight: false, failures: s.failures + 1 };
      // access gone: the board is cleared at once
      return { status: r.kind, board: null, lastOkAt: null, inFlight: false, failures: 0 };
    }
  }
}
/** What the stale banner can say: the last time a read succeeded. */
export const staleSince = (s: TvRefreshState): string | null => (s.board ? s.board.generated_at : null);
