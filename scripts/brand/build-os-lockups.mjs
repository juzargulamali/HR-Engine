// Builds the ENGINIOUS OS lockups and app icons from the ORIGINAL Enginious logo file (apps/web/public/brand/enginious-logo.png).
//
// Nothing is redrawn or traced:
//   - the symbol and the ENGINIOUS lettering are the original pixels, cropped and scaled;
//   - the "OS" is made from the original lettering's own "O" and "S" (the 7th and 9th letters of ENGINIOUS), recoloured;
//   - the only drawn shapes are the four thin corner brackets around "OS" (plain rectangles).
// For dark backgrounds the lettering is made white (its own alpha) and the symbol's two original tones are mapped to two brighter tones
// with the same shading. The light variant keeps the original colours.
//
// Limit: the original is a 464 x 289 raster, so the lockups are raster too (large enough for a 30 px high navigation lockup at 2x).
// Run:  node scripts/brand/build-os-lockups.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BRAND = path.join(ROOT, "apps/web/public/brand");
const SRC = path.join(BRAND, "enginious-logo.png");

// Measured on the original (see the comments in docs/os-branding.md): rows and columns of each part.
const ICON = { x: 70, y: 8, w: 255, h: 181 };
const WORD = { x: 8, y: 214, w: 449, h: 49 };
const LETTER_O = { x: 286, w: 61 };
const LETTER_S = { x: 411, w: 46 };

const DARK = { word: [244, 250, 251], os: [0, 205, 226], dark: [16, 126, 142], cyan: [0, 205, 226], bracket: [0, 205, 226] };
const LIGHT = { word: null, os: [36, 168, 180], dark: null, cyan: null, bracket: [36, 168, 180] };
const ORIG_DARK = [24, 88, 104];
const ORIG_CYAN = [38, 168, 180];

const raw = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = raw.info;

function crop(x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) raw.data.copy(out, j * w * 4, ((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4);
  return out;
}
const png = (buf, w, h) => sharp(buf, { raw: { width: w, height: h, channels: 4 } });
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** Same pixels, same alpha; only the two original tones are mapped to two other tones (shading kept by interpolating on the green channel). */
function remapSymbol(buf, to) {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i += 4) {
    const t = Math.max(0, Math.min(1, (out[i + 1] - ORIG_DARK[1]) / (ORIG_CYAN[1] - ORIG_DARK[1])));
    out[i] = lerp(to.dark[0], to.cyan[0], t); out[i + 1] = lerp(to.dark[1], to.cyan[1], t); out[i + 2] = lerp(to.dark[2], to.cyan[2], t);
  }
  return out;
}
/** Same alpha, a flat colour: the letter shapes are the original ones. */
function flat(buf, rgb) {
  const out = Buffer.from(buf);
  for (let i = 0; i < out.length; i += 4) { out[i] = rgb[0]; out[i + 1] = rgb[1]; out[i + 2] = rgb[2]; }
  return out;
}

async function lockup(variant, to) {
  const iconH = 120, iconW = Math.round((ICON.w * iconH) / ICON.h);
  let iconBuf = crop(ICON.x, ICON.y, ICON.w, ICON.h);
  if (to.dark) iconBuf = remapSymbol(iconBuf, to);
  const icon = await png(iconBuf, ICON.w, ICON.h).resize(iconW, iconH, { kernel: "lanczos3" }).png().toBuffer();

  let wordBuf = crop(WORD.x, WORD.y, WORD.w, WORD.h);
  if (to.word) wordBuf = flat(wordBuf, to.word);
  const word = await png(wordBuf, WORD.w, WORD.h).png().toBuffer();

  const scale = 0.7;
  const glyph = async (g) => png(flat(crop(g.x, WORD.y, g.w, WORD.h), to.os), g.w, WORD.h).resize(Math.round(g.w * scale), Math.round(WORD.h * scale), { kernel: "lanczos3" }).png().toBuffer();
  const o = await glyph(LETTER_O), s = await glyph(LETTER_S);
  const oW = Math.round(LETTER_O.w * scale), sW = Math.round(LETTER_S.w * scale), gH = Math.round(WORD.h * scale), gap = 7;

  const pad = 15, boxW = oW + gap + sW + pad * 2, boxH = Math.round(WORD.h * 1.3), arm = Math.round(boxH * 0.3), t = 4;
  const gapA = 24, gapB = 16;
  const wordX = iconW + gapA, boxX = wordX + WORD.w + gapB;
  const canvasW = boxX + boxW + 2, canvasH = iconH + 4;
  const wordY = Math.round((canvasH - WORD.h) / 2), boxY = wordY - Math.round((boxH - WORD.h) / 2);
  const b = to.bracket.join(",");
  const rect = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${b})"/>`;
  const L = boxX, R = boxX + boxW, T = boxY, B = boxY + boxH;
  const brackets = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}">${[
    rect(L, T, arm, t), rect(L, T, t, arm), rect(R - arm, T, arm, t), rect(R - t, T, t, arm),
    rect(L, B - t, arm, t), rect(L, B - arm, t, arm), rect(R - arm, B - t, arm, t), rect(R - t, B - arm, t, arm),
  ].join("")}</svg>`);
  const gy = boxY + Math.round((boxH - gH) / 2);

  const out = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: icon, left: 0, top: Math.round((canvasH - iconH) / 2) },
      { input: word, left: wordX, top: wordY },
      { input: o, left: boxX + pad, top: gy },
      { input: s, left: boxX + pad + oW + gap, top: gy },
      { input: brackets, left: 0, top: 0 },
    ]).png({ compressionLevel: 9 }).toBuffer();
  await sharp(out).toFile(path.join(BRAND, `enginious-os-lockup-${variant}.png`));
  console.log(`enginious-os-lockup-${variant}.png ${canvasW}x${canvasH}`);
  return { iconBuf };
}

/** The symbol alone, for small sizes: a rounded dark tile so it reads on any browser chrome. */
async function appIcon(size, file) {
  const to = DARK;
  const mark = await png(remapSymbol(crop(ICON.x, ICON.y, ICON.w, ICON.h), to), ICON.w, ICON.h).resize({ width: Math.round(size * 0.74), kernel: "lanczos3" }).png().toBuffer();
  const meta = await sharp(mark).metadata();
  const tile = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * 0.22)}" fill="#0b2128"/></svg>`);
  await sharp(tile).composite([{ input: mark, left: Math.round((size - meta.width) / 2), top: Math.round((size - meta.height) / 2) }]).png({ compressionLevel: 9 }).toFile(file);
  console.log(`${path.relative(ROOT, file)} ${size}x${size}`);
}

await lockup("dark", DARK);
await lockup("light", LIGHT);
// Symbol only, both tones, transparent (for small in-app uses).
await sharp(await png(remapSymbol(crop(ICON.x, ICON.y, ICON.w, ICON.h), DARK), ICON.w, ICON.h).png().toBuffer()).toFile(path.join(BRAND, "enginious-os-symbol-dark.png"));
await appIcon(256, path.join(ROOT, "apps/web/src/app/icon.png"));
await appIcon(180, path.join(ROOT, "apps/web/src/app/apple-icon.png"));
