# ENGINIOUS OS: product branding

The product identity is **ENGINIOUS OS**, "a product of ENGINIOUS". It is made from the company's original logo file, not redrawn.

## What the assets are

| File | Use |
| --- | --- |
| `apps/web/public/brand/enginious-os-lockup-dark.png` | Compact horizontal lockup (symbol, ENGINIOUS, OS) for dark surfaces: the navigation sidebar and the sign-in pages (through `OsLogo`). 772 × 124. |
| `apps/web/public/brand/enginious-os-lockup-light.png` | The same lockup for light surfaces (original colours). |
| `apps/web/public/brand/enginious-os-symbol-dark.png` | The symbol alone, small: the collapsed navigation and the phone top bar. |
| `apps/web/src/app/icon.png`, `apple-icon.png` | Browser tab and home-screen icons (256 and 180 px), built from the symbol. |
| `apps/web/public/brand/os-header-art.svg` | Decorative artwork behind page headers. Contains no text; headings, numbers and controls stay real HTML. |
| `apps/web/public/brand/enginious-logo.png` | The **original** company logo. Unchanged; it is the source for everything above. |

`<OsLogo>` (`components/brand/os-logo.tsx`) renders the lockup on the sign-in pages; the navigation uses the same files directly. `endorsement` adds the written line "A product of ENGINIOUS" (real text, so it scales and is read by assistive technology); it is used on the sign-in page and is available for an About screen.

## How they were made

`node scripts/brand/build-os-lockups.mjs` rebuilds every file from `enginious-logo.png`:

- The symbol and the ENGINIOUS lettering are the **original pixels**, cropped and scaled. Nothing is traced or auto-converted.
- "OS" is made from the original lettering's own **O** and **S** (the 7th and 9th letters of ENGINIOUS), recoloured to the accent, so the weight, curves and spacing match the company wordmark exactly.
- The only shapes drawn are four thin corner brackets around "OS" (plain rectangles).
- For dark surfaces the lettering is made white using its own transparency, and the symbol's two original tones are mapped to two brighter tones with the same shading. The light version keeps the original colours.

The crop rectangles and letter positions are measured constants at the top of the script.

## Known limits

- The original logo is a **464 × 289 raster**, and no vector or editable-lettering file is in the repository. The lockups are therefore raster too. They are generated large enough for a 30 px-high lockup at 2× density; they will look soft if enlarged much beyond that.
- A true vector lockup needs the original vector artwork from the designer. Dropping it in means replacing the five files above (and re-pointing `OsLogo`); nothing else depends on how they were made.
- The logo reference image supplied for the redesign was used only as a visual guide. It was not pasted into the app and not traced.

## What did not change

Repository names, the database project, environment variables and URLs keep their current names. Only what people see (navigation, sign-in, icons) changed.
