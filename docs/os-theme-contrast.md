# ENGINIOUS OS theme: readability and WCAG AA contrast

Two themes only (dark by default, light through the existing toggle; the saved choice is still the `theme` key in the browser). Both are defined once, as tokens, in `apps/web/src/app/globals.css`, so HR and Sales change together. This file records what was measured. Re-run the measurements any time with the commands at the end.

## Surfaces and text

| Token | Dark | Light | Used for |
|---|---|---|---|
| `background` | `#131c20` | `#e7ecee` | page |
| `chrome` | `#0f171a` | `#dce2e5` | sidebar, header, mobile menu and bottom bar |
| `card` | `#1f2b30` | `#f6f8f9` | panels, tables, stat cards |
| `raised` | `#29373d` | `#ffffff` | menus and popovers |
| `field` | `#162024` | `#ffffff` | inputs, selects, search |
| `foreground` | `#eaf0f0` | `#15262e` | primary text |
| `muted-foreground` | `#b3c3c7` | `#394d56` | secondary text |
| `subtle` | `#8da1a5` | `#4f5e64` | tertiary labels |
| `border` | `#324248` | `#c2ccd1` | decorative separators |
| `input` | `#6b8c94` | `#677a83` | control boundaries |
| `primary` | `#28b8ae` | `#096c65` | main action fill |
| `accent` | `#5ad9e2` | `#0c686e` | selection and links |
| `ring` | `#63e4ee` | `#086168` | keyboard focus |

Dark keeps the teal identity but is lifted: page and panels are about 4 to 5 steps lighter than before, with a distinct step between page, panel, field and menu. Light is a soft cool grey page with off-white cards, a slightly darker neutral sidebar and header, white inputs, and charcoal text; secondary text is a slate, not a faded grey. The decorative grid and glow are gone from the app shell, the dashboard and buttons (the sign-in screen keeps a faint texture).

## Token-level contrast (computed from the real token values)

Minimum required: 4.5:1 for normal text, 3:1 for large text and for control boundaries and indicators. CI enforces these in `src/app/theme-contrast.test.ts`.

| Combination | Surface | Dark | Light | Need |
|---|---|---|---|---|
| Primary text (`foreground`) | background | 15.00 | 13.07 | 7 |
| Primary text (`foreground`) | chrome | 15.74 | 11.90 | 7 |
| Primary text (`foreground`) | card | 12.60 | 14.62 | 7 |
| Primary text (`foreground`) | raised | 10.67 | 15.57 | 7 |
| Primary text (`foreground`) | field | 14.39 | 15.57 | 7 |
| Secondary text (`muted-foreground`) | background | 9.51 | 7.44 | 4.5 |
| Secondary text (`muted-foreground`) | chrome | 9.97 | 6.77 | 4.5 |
| Secondary text (`muted-foreground`) | card | 7.98 | 8.32 | 4.5 |
| Secondary text (`muted-foreground`) | raised | 6.76 | 8.86 | 4.5 |
| Secondary text (`muted-foreground`) | field | 9.12 | 8.86 | 4.5 |
| Secondary text (`muted-foreground`) | secondary | 6.21 | 7.10 | 4.5 |
| Tertiary text (`subtle`: section labels, "Coming soon") | background | 6.40 | 5.66 | 4.5 |
| Tertiary text (`subtle`: section labels, "Coming soon") | chrome | 6.71 | 5.15 | 4.5 |
| Tertiary text (`subtle`: section labels, "Coming soon") | card | 5.37 | 6.32 | 4.5 |
| Link / highlight text (`accent`) | card | 8.61 | 6.12 | 4.5 |
| Link / highlight text (`accent`) | chrome | 10.76 | 4.98 | 4.5 |
| Destructive text | card | 5.54 | 6.60 | 4.5 |
| Success text | card | 7.47 | 6.10 | 4.5 |
| Warning text | card | 8.21 | 5.82 | 4.5 |
| Control border (`input`) | background | 4.78 | 3.76 | 3 |
| Control border (`input`) | chrome | 5.01 | 3.42 | 3 |
| Control border (`input`) | card | 4.01 | 4.20 | 3 |
| Control border (`input`) | raised | 3.40 | 4.48 | 3 |
| Control border (`input`) | field | 4.58 | 4.48 | 3 |
| Keyboard focus ring (`ring`) | background | 11.41 | 6.04 | 3 |
| Keyboard focus ring (`ring`) | chrome | 11.97 | 5.50 | 3 |
| Keyboard focus ring (`ring`) | card | 9.58 | 6.75 | 3 |
| Keyboard focus ring (`ring`) | raised | 8.12 | 7.19 | 3 |
| Keyboard focus ring (`ring`) | field | 10.95 | 7.19 | 3 |
| Text on `primary` fill (buttons, badges) | primary | 7.35 | 6.28 | 4.5 |
| Text on `accent` fill (buttons, badges) | accent | 10.71 | 6.52 | 4.5 |
| Text on `destructive` fill (buttons, badges) | destructive | 7.01 | 7.03 | 4.5 |
| Text on `success` fill (buttons, badges) | success | 8.72 | 6.50 | 4.5 |
| Text on `warning` fill (buttons, badges) | warning | 9.67 | 6.20 | 4.5 |
| Button text on the brand gradient (both ends) | deep / glow | 5.98 | 4.69 | 4.5 |

## Rendered measurement (the real pages)

`os-shell-checks/contrast-audit.mjs` opens every page in a real browser, finds every visible piece of text, resolves its actual colour and the actual background behind it (compositing translucent layers; gradients are checked at both ends), and applies 4.5:1 (3:1 for large text). Closed menus are excluded; dialogs, the command palette and the account menu are measured while open.

| Run (production build, local stack) | Page states | Text elements checked | Below AA |
|---|---|---|---|
| Founder, desktop 1440 px, both themes | 74 | 4,626 | 0 |
| Founder, phone 390 px, both themes | 74 | 3,648 | 0 |
| Sales user, desktop, both themes | 68 | 3,158 | 0 |
| HR Admin, desktop, both themes | 66 | 3,050 | 0 |
| Employee without Sales access, desktop, both themes | 66 | 1,742 | 0 |

Across all runs: 16,224 text elements, none below AA. Form controls: the weakest input/select/textarea border measured against the surface behind it was 3.76:1 (need 3:1).

Closest to the limit (rendered): 4.53:1 (need 4.5) in light theme, "5-minute processor: not veri"; 4.53:1 (need 4.5) in light theme, "No job title set."; 4.53:1 (need 4.5) in light theme, "No job title set.".

## What the measurements found while building it

- Honest baseline: the old secondary-text colour already measured 7.15:1 (dark) and 5.40:1 (light) on cards, so the complaint was less about the ratio than about how it felt: the dark page and panels were nearly the same near-black (card against page 1.07:1), light cards were pure white on a bright page (1.06:1), 10 to 11 px labels were common, and decorative grids and glows competed with content. The new surfaces step apart more (card against page 1.19:1 dark, 1.12:1 light, plus a visible border), secondary text is stronger (8.1:1 dark, 8.3:1 light), the text people read is about 14 px (12 px only for badges, shortcut chips, tooltips and footnotes), and the grid and glow are removed from the app.
- The old tokens used the OS colour-scheme for Tailwind's `dark:` classes while the app switches by attribute, so Sales badges could show light-theme colours on a dark page. The `dark:` variant now follows the app's own theme.
- In the first draft of the new light theme, section labels in the sidebar measured 4.25:1; the tertiary token was darkened.
- The "Sent" proposal badge in light measured 4.49:1 on first measurement; the badge text colours were deepened one step.
- Keyboard focus is one 2 px ring (`ring` token, at least 3:1 on every surface) everywhere, including controls that draw their own ring.

## Re-run

```bash
cd apps/web
npx vitest run src/app/theme-contrast.test.ts          # tokens, runs in CI
node os-shell-checks/contrast-audit.mjs out.json ceo@e2e.local desktop   # rendered pages (local stack, see os-shell-checks/README.md)
```
