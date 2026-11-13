import { InfoHint } from "@/components/ui/info-hint";

/** A page title with its optional explanation behind one ⓘ beside the heading (instead of a paragraph under it). `actions` sit at the right, like PageHeader. */
export function PageTitle({ title, hint, actions }: { title: string; hint?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="flex items-center gap-1.5 text-2xl font-semibold">{title}{hint ? <InfoHint label={title}>{hint}</InfoHint> : null}</h1>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
