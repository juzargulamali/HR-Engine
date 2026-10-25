import { PEOPLE, type Project } from "../_lib/sample";
import { Avatar } from "./bits";

/** The compact header graphic: words on the left over a plain area, the drawing to the right, actions in a quiet row. Dark in both themes. */
export function Hero({ eyebrow, title, sub, meta, children }: { eyebrow?: React.ReactNode; title: string; sub?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="cx-hero cx-chrome px-5 py-5 sm:px-8 sm:py-6">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          {eyebrow ? <p className="cx-hero-sub text-sm">{eyebrow}</p> : null}
          <h1 className="break-words font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h1>
          {sub ? <p className="cx-hero-sub mt-1 text-base">{sub}</p> : null}
          {meta ? <div className="cx-hero-sub mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">{meta}</div> : null}
        </div>
        {children ? <div className="flex flex-wrap items-center gap-3">{children}</div> : null}
      </div>
    </div>
  );
}

/** Up to three people in the project, then "+N": the manager first, then whoever has a task. */
export function TeamStack({ project, assignees }: { project: Project; assignees: (string | null)[] }) {
  const ids = [project.pm, ...assignees.filter((a): a is string => !!a)].filter((v, i, a) => a.indexOf(v) === i);
  const name = (id: string) => PEOPLE.find((p) => p.id === id)?.name ?? "Hamza Idris";
  const shown = ids.slice(0, 3);
  return (
    <div className="flex items-center gap-2">
      <ul className="flex -space-x-2" aria-label={`Team: ${ids.map(name).join(", ")}`}>
        {shown.map((id) => <li key={id}><Avatar name={name(id)} size="lg" /></li>)}
        {ids.length > 3 ? <li><span className="cx-avatar" data-size="lg" aria-hidden>+{ids.length - 3}</span></li> : null}
      </ul>
      <span className="cx-hero-sub text-sm">Team</span>
    </div>
  );
}
