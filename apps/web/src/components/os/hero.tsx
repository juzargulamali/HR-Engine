import { OsAvatar } from "./pills";

/**
 * The compact header graphic: words on the left over a plain area, the drawing behind the right-hand side, controls on a quiet backing.
 * Text, numbers and controls are HTML; the artwork is a background image (public/brand/os-header-art.svg). Dark in both themes.
 */
export function OsHero({ eyebrow, title, sub, meta, children }: { eyebrow?: React.ReactNode; title: string; sub?: React.ReactNode; meta?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="os-hero os-chrome px-4 pb-4 pt-3 sm:px-8 sm:py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 lg:max-w-[50%]">
          {eyebrow ? <p className="os-hero-sub flex min-h-[26px] items-center text-sm sm:hidden">{eyebrow}</p> : null}
          <h1 className="break-words font-heading text-xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">{title}</h1>
          {sub ? <p className="os-hero-sub mt-0.5 text-sm sm:mt-1 sm:text-base">{sub}</p> : null}
          {meta ? <div className="os-hero-sub mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] sm:mt-3 sm:gap-x-4 sm:gap-y-2 sm:text-sm">{meta}</div> : null}
        </div>
        {children ? <div className="os-hero-actions flex flex-wrap items-center gap-2.5 sm:gap-3">{children}</div> : null}
      </div>
    </div>
  );
}

/** Up to three people, then "+N". Names are listed for assistive technology. */
export function OsTeamStack({ names, label = "Team" }: { names: string[]; label?: string }) {
  const shown = names.slice(0, 3);
  return (
    <div className="flex items-center gap-2">
      <ul className="flex -space-x-0.5 sm:-space-x-2" aria-label={`${label}: ${names.join(", ")}`}>
        {shown.map((n) => <li key={n}><OsAvatar name={n} size="lg" /></li>)}
        {names.length > 3 ? <li><span className="os-avatar" data-size="lg" aria-hidden>+{names.length - 3}</span></li> : null}
      </ul>
      <span className="os-hero-sub hidden text-sm sm:inline">{label}</span>
    </div>
  );
}
