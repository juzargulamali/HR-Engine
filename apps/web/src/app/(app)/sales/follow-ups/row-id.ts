/**
 * The id a follow-up's row carries on the Follow-ups page, so a link with `?focus=<id>` can be scrolled to. It lives in a plain module (not the client
 * file that scrolls) because the server page calls it while rendering the rows: a function exported from a client file cannot be called on the server.
 */
export const followUpRowId = (id: string) => `follow-up-${id}`;
