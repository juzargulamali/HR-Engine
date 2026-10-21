/**
 * Every Inventory movement carries a key so that a repeated click or a retry after a lost connection can never record a second receipt or
 * movement. A form makes ONE key when it opens and keeps it until the movement is confirmed; the database returns the original result
 * for the same key and the same content. After an uncertain failure the page offers "Check whether it went through"
 * (inv_transaction_status with the same key) before anything is sent again.
 */
export function newMovementKey(prefix = "mv"): string {
  const rand = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`.slice(0, 120);
}

export const MOVEMENT_KEY_RE = /^[A-Za-z0-9._:-]{8,120}$/;
export function isValidMovementKey(key: string): boolean {
  return MOVEMENT_KEY_RE.test(key);
}
