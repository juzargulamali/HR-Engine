import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuotationDocModel } from "./doc-model";

/** A picture ready to embed: PNG or JPEG bytes only (the two formats both react-pdf and exceljs embed). */
export interface ExportImage { data: Buffer; format: "png" | "jpg" }
export interface ExportAssets {
  /** image key (file id) -> bytes; a picture that could not be fetched or decoded is simply absent. */
  images: Map<string, ExportImage>;
  /** The issuer's logo from the company-logos bucket, or null (the document then uses the bundled ENGINIOUS logo). */
  logo: ExportImage | null;
  /** Pictures that were referenced but could not be shown (reported in the response header, never an error). */
  missing: number;
}
export type StorageReader = (bucket: "crm-files" | "company-logos" | "quotation-assets", path: string) => Promise<Uint8Array | null>;

/** Reads stored bytes with the service client. Callers reach this only AFTER the person's own session has read the quotation (row-level security), exactly like the on-screen thumbnails. */
export const readFromStorage: StorageReader = async (bucket, path) => {
  const { data, error } = await createAdminClient().storage.from(bucket).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
};

const THUMB = 240;

/** PNG / JPEG / WebP by the bytes themselves (never by file name or claimed type). */
export function detectImage(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  const b = Buffer.from(bytes);
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

/** Converts WebP and shrinks to a thumbnail when the image library is present. Null = cannot be embedded. */
export async function normaliseImage(bytes: Uint8Array): Promise<ExportImage | null> {
  const b = Buffer.from(bytes);
  const kind = detectImage(b);
  if (!kind) return null;
  const isJpg = kind === "jpg";
  const isWebp = kind === "webp";
  try {
    // `sharp` ships with Next.js for image optimisation; it is optional here: without it PNG and JPEG are embedded as stored and WebP is left out.
    const sharp = (await import("sharp")).default;
    const img = sharp(b, { failOn: "error" }).rotate().resize({ width: THUMB, height: THUMB, fit: "inside", withoutEnlargement: true });
    if (isJpg) return { data: await img.jpeg({ quality: 82 }).toBuffer(), format: "jpg" };
    return { data: await img.png().toBuffer(), format: "png" };
  } catch {
    return isWebp ? null : { data: b, format: isJpg ? "jpg" : "png" };
  }
}

/** A pinned copy is checked against the SHA-256 recorded in the snapshot; bytes that do not match are never embedded. A live (draft) reference has no hash to check. */
const intact = (raw: Uint8Array, sha256: string | null) => sha256 === null || createHash("sha256").update(raw).digest("hex") === sha256;

/** Fetches every picture of the model plus the issuer logo, once each. Any failure leaves that picture out; it never fails the export. */
export async function loadExportAssets(model: QuotationDocModel, read: StorageReader = readFromStorage): Promise<ExportAssets> {
  const images = new Map<string, ExportImage>();
  const wanted = new Map<string, string>();
  const wantedBucket = new Map<string, "crm-files" | "company-logos" | "quotation-assets">();
  const wantedSha = new Map<string, string | null>();
  for (const s of model.sections) for (const l of s.lines) if (l.image && !wanted.has(l.image.key)) { wanted.set(l.image.key, l.image.storagePath); wantedBucket.set(l.image.key, l.image.bucket); wantedSha.set(l.image.key, l.image.sha256); }
  let missing = 0;
  await Promise.all([...wanted].map(async ([key, path]) => {
    try {
      const raw = await read(wantedBucket.get(key)!, path);
      const img = raw && intact(raw, wantedSha.get(key) ?? null) ? await normaliseImage(raw) : null;
      if (img) images.set(key, img); else missing += 1;
    } catch { missing += 1; }
  }));
  let logo: ExportImage | null = null;
  const lg = model.issuer.logo;
  if (lg) {
    try { const raw = await read(lg.bucket, lg.storagePath); logo = raw && intact(raw, lg.sha256) ? await normaliseImage(raw) : null; } catch { logo = null; }
  }
  return { images, logo, missing };
}

/** Pixel size of a PNG or JPEG from its header (no decoding), so a picture can be placed without distortion. Null when it cannot be read. */
export function imageSize(img: ExportImage): { width: number; height: number } | null {
  const b = img.data;
  if (img.format === "png") return b.length >= 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i += 1; continue; }
    const marker = b[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}
