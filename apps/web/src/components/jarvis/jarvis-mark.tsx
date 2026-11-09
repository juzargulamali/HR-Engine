/**
 * The JARVIS mark: an original, geometric "J" whose hook turns inward and ends in a small square (a circuit trace ending in a pad). Inline SVG, no external icon service,
 * no animation. It takes its colour from the CSS token --jarvis-mark (Enginious teal #1D5D6C in the light theme, cyan #27CDD8 in the dark theme, see app/os-design.css), so
 * it follows the theme. Drawn on a 24 grid with a 2.4 stroke so it stays readable at 20 px.
 */
export function JarvisMark({ size = 20, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={className}
      style={{ color: "var(--jarvis-mark)" }}
    >
      <path d="M8.5 4.5h10" stroke="currentColor" strokeWidth="2.4" strokeLinecap="butt" />
      <path d="M14.5 4.5v9.5a4.5 4.5 0 0 1-4.5 4.5H8.2" stroke="currentColor" strokeWidth="2.4" strokeLinecap="butt" strokeLinejoin="miter" />
      <rect x="3.6" y="16.4" width="4.2" height="4.2" fill="currentColor" />
    </svg>
  );
}
