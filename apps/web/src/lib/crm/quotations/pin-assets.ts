import "server-only";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { detectImage } from "./export/images";

/**
 * At issue the company logo and every item picture are PINNED: copied to immutable, content-addressed objects owned by the quotation revision
 * (bucket `quotation-assets`, path `<proposal>/<logo | line-<line id>>-<sha256>.<ext>`), and the snapshot records those paths and hashes, never the mutable
 * source paths. Replacing the company logo or a picture afterwards cannot change an issued quotation or its exports. The database function
 * crm_quote_issue refuses an issue whose assets are not pinned; a trigger on storage.objects refuses to rename or delete a pinned object while its revision exists.
 */
export interface PinnedAsset { path: string; sha256: string; mime_type: string }
export interface PinnedAssets { logo: PinnedAsset | null; lines: Record<string, PinnedAsset> }
export interface PinRequest {
  proposalId: string;
  logo: { bucket: "company-logos"; path: string } | null;
  lines: { lineId: string; position: string; bucket: "crm-files"; path: string }[];
}
export interface PinStorage {
  read(bucket: string, path: string): Promise<Uint8Array | null>;
  /** Stores the bytes at the path; an object that already exists there (same content: the path carries the hash) counts as stored. */
  put(path: string, bytes: Uint8Array, mime: string): Promise<boolean>;
}
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

export const adminPinStorage: PinStorage = {
  async read(bucket, path) {
    const { data, error } = await createAdminClient().storage.from(bucket).download(path);
    return error || !data ? null : new Uint8Array(await data.arrayBuffer());
  },
  async put(path, bytes, mime) {
    const { error } = await createAdminClient().storage.from("quotation-assets").upload(path, bytes, { contentType: mime, upsert: false });
    return !error || /already exists|duplicate/i.test(error.message);
  },
};

/** Copies the assets and returns what crm_quote_issue needs, or a sentence saying which one could not be pinned (nothing is issued then). */
export async function pinAssets(req: PinRequest, storage: PinStorage = adminPinStorage): Promise<{ assets: PinnedAssets } | { error: string }> {
  const pin = async (name: string, bucket: string, path: string): Promise<PinnedAsset | null> => {
    const raw = await storage.read(bucket, path);
    const kind = raw ? detectImage(raw) : null;
    if (!raw || !kind) return null;
    const sha256 = createHash("sha256").update(raw).digest("hex");
    const target = `${req.proposalId}/${name}-${sha256}.${kind}`;
    return (await storage.put(target, raw, MIME[kind])) ? { path: target, sha256, mime_type: MIME[kind] } : null;
  };
  let logo: PinnedAsset | null = null;
  if (req.logo) {
    logo = await pin("logo", req.logo.bucket, req.logo.path);
    if (!logo) return { error: "The company logo could not be read from storage, so nothing was issued. Ask a System Administrator to upload it again on the Companies screen." };
  }
  const lines: Record<string, PinnedAsset> = {};
  for (const l of req.lines) {
    const a = await pin(`line-${l.lineId}`, l.bucket, l.path);
    if (!a) return { error: `The picture of item ${l.position} could not be read from storage, so nothing was issued. Remove it or add it again.` };
    lines[l.lineId] = a;
  }
  return { assets: { logo, lines } };
}
