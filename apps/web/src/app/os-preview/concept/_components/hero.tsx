import { PEOPLE, type Project } from "../_lib/sample";
import { Avatar } from "./bits";

/** The compact header graphic: words on the left over a plain area, the drawing to the right, actions in a quiet row. Dark in both themes. */
export function Hero({ eyebrow, title, sub, meta, children }: { eyebrow?: React.ReactNode; title: string; sub?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="cx-hero cx-chrome px-4 pb-4 pt-3 sm:px-8 sm:py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 lg:max-w-[50%]">
          {eyebrow ? <p className="cx-hero-sub flex min-h-[26px] items-center text-sm sm:hidden">{eyebrow}</p> : null}
          <h1 className="break-words font-heading text-xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">{title}</h1>
          {sub ? <p className="cx-hero-sub mt-0.5 text-sm sm:mt-1 sm:text-base">{sub}</p> : null}
          {meta ? <div className="cx-hero-sub mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] sm:mt-3 sm:gap-x-4 sm:gap-y-2 sm:text-sm">{meta}</div> : null}
        </div>
        {children ? <div className="cx-hero-actions flex flex-wrap items-center gap-2.5 sm:gap-3">{children}</div> : null}
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
      <ul className="flex -space-x-0.5 sm:-space-x-2" aria-label={`Team: ${ids.map(name).join(", ")}`}>
        {shown.map((id) => <li key={id}><Avatar name={name(id)} size="lg" /></li>)}
        {ids.length > 3 ? <li><span className="cx-avatar" data-size="lg" aria-hidden>+{ids.length - 3}</span></li> : null}
      </ul>
      <span className="cx-hero-sub hidden text-sm sm:inline">Team</span>
    </div>
  );
}
