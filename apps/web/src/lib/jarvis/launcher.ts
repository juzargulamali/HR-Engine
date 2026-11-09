import "server-only";
import type { LauncherState } from "./protocol";
import { getJarvis } from "./runtime";

const none: LauncherState = { available: false, writes: false, companies: [], maxInputChars: 0 };

/**
 * For the signed-in layout only: should the launcher be drawn for this person? Any failure means "no launcher" (JARVIS unavailable, everything else normal).
 * This is a convenience, not access control: every JARVIS call re-checks on the server.
 */
export async function getLauncherState(userId: string): Promise<LauncherState> {
  try { return await getJarvis().availability(userId); } catch { return none; }
}
