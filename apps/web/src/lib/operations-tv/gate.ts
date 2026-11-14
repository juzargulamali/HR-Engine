/**
 * Where a display identity may go. A display account carries `app_metadata.ops_tv = true` (set only by the service role when the display is created) and may reach only the board, its
 * refresh route and the sign-in screen (sign-out is a server action posted from the board itself). Everything else is sent back to the board. This is a convenience in front of the real
 * boundary, which is the database: a display has no employee record and no grant, so every existing read and API refuses it by itself.
 */
export const TV_PATH = "/tv";
export const isDisplayUser = (user: { app_metadata?: Record<string, unknown> | null } | null | undefined): boolean => user?.app_metadata?.ops_tv === true;
const under = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);
/** True when a display identity may open this path. */
export const displayMayReach = (pathname: string): boolean => under(pathname, TV_PATH) || under(pathname, "/api/tv") || pathname === "/login";
