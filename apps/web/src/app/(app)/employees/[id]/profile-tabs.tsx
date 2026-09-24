import Link from "next/link";

export interface ProfileTab {
  value: string;
  label: string;
}

/**
 * Plain server-rendered links, not a client component — the active section
 * lives entirely in the URL (`?tab=`), so switching tabs is just normal
 * navigation: works with JS disabled, survives a refresh, and is directly
 * linkable/shareable without any client-side state to rehydrate. Horizontal
 * scroll (rather than wrapping) keeps this usable at narrow widths without a
 * separate mobile-only representation.
 */
export function ProfileTabs({ tabs, active, basePath }: { tabs: ProfileTab[]; active: string; basePath: string }) {
  return (
    <div role="tablist" aria-label="Employee profile sections" className="flex gap-1 overflow-x-auto border-b border-border pb-px">
      {tabs.map((t) => {
        const isActive = t.value === active;
        return (
          <Link
            key={t.value}
            href={`${basePath}?tab=${t.value}`}
            role="tab"
            aria-selected={isActive}
            className={`flex-none whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
