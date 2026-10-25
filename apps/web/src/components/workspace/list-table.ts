/**
 * Class names that make a list table behave at every width without extra markup:
 *  - `compactTable`: tighter cell padding, so a full set of columns fits beside the sidebar on a laptop.
 *  - `stackedOnPhone`: below the `md` breakpoint each row becomes a small card (header hidden from view but still read by screen
 *    readers); every cell that carries a `data-label` shows that label before its value, and the first cell (the record's name) is the
 *    card's title. This keeps every action visible on a phone instead of hiding it behind a sideways scroll.
 * Put both on the <Table> and add `data-label` to each cell except the first.
 */
export const compactTable = "[&_th]:px-3 [&_td]:px-3 [&_td]:py-2.5";

export const stackedOnPhone = [
  "max-md:min-w-0 max-md:[&_thead]:sr-only max-md:[&_tbody_tr]:block max-md:[&_tbody_tr]:py-2",
  "max-md:[&_td]:flex max-md:[&_td]:items-baseline max-md:[&_td]:justify-between max-md:[&_td]:gap-3 max-md:[&_td]:border-0 max-md:[&_td]:py-1 max-md:[&_td]:text-right",
  "max-md:[&_td[data-label]]:before:content-[attr(data-label)] max-md:[&_td[data-label]]:before:shrink-0 max-md:[&_td[data-label]]:before:text-left max-md:[&_td[data-label]]:before:text-[13px] max-md:[&_td[data-label]]:before:font-medium max-md:[&_td[data-label]]:before:text-muted-foreground",
  "max-md:[&_td:first-child]:block max-md:[&_td:first-child]:text-left",
].join(" ");

export const listTable = `${compactTable} ${stackedOnPhone}`;

/**
 * The same stacking as `stackedOnPhone`, but decided by the width of the nearest `@container` instead of the screen: for a table that
 * sits in a side panel (about 38rem wide) on a large screen, where the screen is wide and the table still does not fit.
 * Put `@container` on an element around the <Table> and this on the <Table>.
 */
export const stackedInNarrowContainer = [
  "@max-3xl:min-w-0 @max-3xl:[&_thead]:sr-only @max-3xl:[&_tbody_tr]:block @max-3xl:[&_tbody_tr]:py-2",
  "@max-3xl:[&_td]:flex @max-3xl:[&_td]:items-baseline @max-3xl:[&_td]:justify-between @max-3xl:[&_td]:gap-3 @max-3xl:[&_td]:border-0 @max-3xl:[&_td]:py-1 @max-3xl:[&_td]:text-right",
  "@max-3xl:[&_td[data-label]]:before:content-[attr(data-label)] @max-3xl:[&_td[data-label]]:before:shrink-0 @max-3xl:[&_td[data-label]]:before:text-left @max-3xl:[&_td[data-label]]:before:text-[13px] @max-3xl:[&_td[data-label]]:before:font-medium @max-3xl:[&_td[data-label]]:before:text-muted-foreground",
  "@max-3xl:[&_td:first-child]:block @max-3xl:[&_td:first-child]:text-left",
].join(" ");
