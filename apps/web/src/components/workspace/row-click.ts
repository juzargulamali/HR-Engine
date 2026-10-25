/**
 * Which clicks on a table row open the row. A click on (or inside) anything that has its own job, a link, a button, a form field, a menu,
 * a dialog, must do only that job; a click on the empty part of the row opens the record. A drag that selected text, a modified click and
 * a non-primary button never open it. Pure, so the rule is tested without a browser.
 */
export const ROW_INTERACTIVE =
  'a[href],button,input,select,textarea,label,summary,[role="menu"],[role="menuitem"],[role="dialog"],[role="listbox"],[role="combobox"],[role="checkbox"],[role="switch"],dialog,[contenteditable="true"],[data-row-ignore]';

interface ClickTarget { closest(selector: string): unknown }
interface RowLike { contains(node: unknown): boolean }

export function shouldOpenRow(target: ClickTarget | null, row: RowLike, click: { defaultPrevented: boolean; button: number }, selectedText: string): boolean {
  if (click.defaultPrevented || click.button !== 0) return false;
  if (selectedText.trim().length > 0) return false;
  if (!target) return false;
  const hit = target.closest(ROW_INTERACTIVE);
  // An interactive element that merely contains the whole row (never the case today) would not count as the row's own control.
  return !(hit && row.contains(hit));
}
