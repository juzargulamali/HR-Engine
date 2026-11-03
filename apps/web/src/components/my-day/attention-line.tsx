import { ATTENTION_LIST_ID, type AttentionHeadline } from "@/lib/my-day/attention";

/**
 * The sentence under the greeting. The number (or the "could not be loaded" part) is a link to the "Needs me" list on this page, where each counted item
 * is named; the sentence and the list are both made from the same `Attention`.
 */
export function AttentionLine({ headline }: { headline: AttentionHeadline }) {
  return (
    <>
      {headline.prefix}
      <a href={`#${ATTENTION_LIST_ID}`} className="font-medium underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{headline.link}</a>
      {headline.suffix}
    </>
  );
}
