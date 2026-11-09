// LOCAL-ONLY stand-in for the parts of Supabase Storage the app's private-file flows use, so a photo can be uploaded, checked, attached, shown and pinned against
// the throwaway database. It is NOT Supabase Storage: bytes live in this process's memory (gone when the gateway stops) and it enforces nothing (access is decided by
// the app and the database before a signed URL is ever issued). It mirrors the storage-js calls the app makes: createSignedUploadUrl / uploadToSignedUrl (quarantine),
// download, upload, remove, createSignedUrl(s) and the signed GET. It also keeps `storage.objects` (the stub table) in step, because database functions check it
// (crm_register_uploaded_file, crm_quote_issue).
import crypto from "node:crypto";

export function createLocalStorage({ pool, send, readBody }) {
  const files = new Map();      // `${bucket}/${path}` -> { bytes, mime }
  const tokens = new Map();     // upload / download token -> `${bucket}/${path}`
  const key = (bucket, path) => `${bucket}/${path}`;
  const token = (k) => { const t = crypto.randomBytes(16).toString("hex"); tokens.set(t, k); return t; };
  const split = (rest) => { const i = rest.indexOf("/"); return i < 0 ? [rest, ""] : [rest.slice(0, i), decodeURIComponent(rest.slice(i + 1))]; };

  const row = async (bucket, path, present) => {
    await pool.query("insert into storage.buckets (id, name) values ($1, $1) on conflict (id) do nothing", [bucket]);
    if (present) { await pool.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, path]); await pool.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, path]); }
    else await pool.query("delete from storage.objects where bucket_id = $1 and name = $2", [bucket, path]);
  };
  /** The bytes of a request body: a multipart form (the browser's upload, field with a filename) or the raw bytes. */
  const bytesOf = (req, body) => {
    const type = String(req.headers["content-type"] ?? "");
    const m = /multipart\/form-data;\s*boundary=(.+)$/i.exec(type);
    if (!m) return { bytes: body, mime: type || "application/octet-stream" };
    const boundary = Buffer.from(`--${m[1]}`);
    let at = 0;
    while (at < body.length) {
      const start = body.indexOf(boundary, at); if (start < 0) break;
      const headEnd = body.indexOf("\r\n\r\n", start); if (headEnd < 0) break;
      const head = body.subarray(start, headEnd).toString("latin1");
      const next = body.indexOf(boundary, headEnd + 4); if (next < 0) break;
      if (/filename=/i.test(head)) { const ct = /content-type:\s*([^\r\n]+)/i.exec(head); return { bytes: body.subarray(headEnd + 4, next - 2), mime: ct?.[1] ?? "application/octet-stream" }; }
      at = next;
    }
    return { bytes: Buffer.alloc(0), mime: "application/octet-stream" };
  };

  return async function handle(req, res, url) {
    const p = url.pathname;
    if (!p.startsWith("/storage/v1/")) return false;
    const rest = p.slice("/storage/v1/".length);
    const q = (name) => url.searchParams.get(name);
    let m;
    // createSignedUploadUrl
    if (req.method === "POST" && (m = /^object\/upload\/sign\/(.+)$/.exec(rest))) {
      const [bucket, path] = split(m[1]); const t = token(key(bucket, path));
      send(res, 200, { url: `/object/upload/sign/${bucket}/${path}?token=${t}` }); return true;
    }
    // uploadToSignedUrl (the browser)
    if (req.method === "PUT" && (m = /^object\/upload\/sign\/(.+)$/.exec(rest))) {
      const [bucket, path] = split(m[1]);
      if (tokens.get(q("token") ?? "") !== key(bucket, path)) { send(res, 403, { message: "invalid upload token" }); return true; }
      const { bytes, mime } = bytesOf(req, await readBody(req));
      files.set(key(bucket, path), { bytes, mime }); await row(bucket, path, true);
      send(res, 200, { Key: key(bucket, path) }); return true;
    }
    // createSignedUrls (many)
    if (req.method === "POST" && (m = /^object\/sign\/([^/]+)$/.exec(rest))) {
      const { paths = [] } = JSON.parse((await readBody(req)).toString() || "{}");
      send(res, 200, paths.map((path) => ({ path, error: null, signedURL: `/object/sign/${m[1]}/${path}?token=${token(key(m[1], path))}` }))); return true;
    }
    // createSignedUrl (one)
    if (req.method === "POST" && (m = /^object\/sign\/(.+)$/.exec(rest))) {
      const [bucket, path] = split(m[1]);
      send(res, 200, { signedURL: `/object/sign/${bucket}/${path}?token=${token(key(bucket, path))}` }); return true;
    }
    // the signed GET (an <img>) and an admin download
    if (req.method === "GET" && ((m = /^object\/sign\/(.+)$/.exec(rest)) || (m = /^object\/(?:authenticated\/)?(.+)$/.exec(rest)))) {
      const [bucket, path] = split(m[1]); const f = files.get(key(bucket, path));
      if (!f) { send(res, 404, { message: "Object not found" }); return true; }
      res.writeHead(200, { "content-type": f.mime, "content-length": f.bytes.length }); res.end(f.bytes); return true;
    }
    // upload (server side, raw bytes)
    if (req.method === "POST" && (m = /^object\/([^/]+)\/(.+)$/.exec(rest))) {
      const [bucket, path] = [m[1], decodeURIComponent(m[2])];
      if (files.has(key(bucket, path)) && req.headers["x-upsert"] !== "true") { send(res, 409, { statusCode: "409", error: "Duplicate", message: "The resource already exists" }); return true; }
      const { bytes, mime } = bytesOf(req, await readBody(req));
      files.set(key(bucket, path), { bytes, mime: String(req.headers["content-type"] ?? "").startsWith("multipart/") ? mime : String(req.headers["content-type"] ?? mime) }); await row(bucket, path, true);
      send(res, 200, { Key: key(bucket, path), Id: crypto.randomUUID() }); return true;
    }
    // remove
    if (req.method === "DELETE" && (m = /^object\/([^/]+)$/.exec(rest))) {
      const { prefixes = [] } = JSON.parse((await readBody(req)).toString() || "{}");
      for (const path of prefixes) { files.delete(key(m[1], path)); await row(m[1], path, false); }
      send(res, 200, prefixes.map((name) => ({ name, bucket_id: m[1] }))); return true;
    }
    send(res, 404, { message: `local stack storage: ${req.method} ${p} is not implemented` });
    return true;
  };
}
