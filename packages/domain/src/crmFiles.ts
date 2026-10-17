/**
 * Server-side validation for Sales & CRM uploads. The browser's `accept` attribute is a hint only; every upload is
 * checked here (name, declared type, size AND the file's own leading bytes) before it reaches private storage, and the
 * database table and storage bucket repeat the type and size rules. Executables, scripts and macro-enabled Office
 * formats are refused — including when they are disguised by a double extension or a wrong content type.
 */

export const CRM_MAX_FILE_BYTES = 20 * 1024 * 1024; // keep in step with crm_files and the crm-files bucket (20 MiB)

export interface CrmFileType {
  ext: string;
  mime: string;
  label: string;
}

/** Keep in step with crm_allowed_mime_types() in supabase/migrations/20261115000100_crm_core_tables.sql. */
export const CRM_ALLOWED_FILE_TYPES: readonly CrmFileType[] = [
  { ext: "pdf", mime: "application/pdf", label: "PDF" },
  { ext: "jpg", mime: "image/jpeg", label: "JPEG image" },
  { ext: "jpeg", mime: "image/jpeg", label: "JPEG image" },
  { ext: "png", mime: "image/png", label: "PNG image" },
  { ext: "webp", mime: "image/webp", label: "WebP image" },
  { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word document" },
  { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", label: "Excel workbook" },
  { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint presentation" },
  { ext: "txt", mime: "text/plain", label: "Text file" },
  { ext: "csv", mime: "text/csv", label: "CSV file" },
];

export const CRM_ALLOWED_FILE_SUMMARY = "PDF, JPEG, PNG, WebP, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), text or CSV, up to 20 MB";

/** Any dot-separated segment of the name matching one of these is refused ("invoice.exe.pdf" included). Keep in step with crm_files_file_shape. */
const BLOCKED_SEGMENT =
  /^(exe|dll|msi|bat|cmd|com|scr|pif|cpl|msc|lnk|hta|wsf|wsh|vbs|vbe|js|jse|ps1|psm1|sh|bash|jar|apk|app|dmg|iso|reg|docm|dotm|xlsm|xlsb|xltm|xlam|pptm|potm|ppsm|ppam|sldm|html|htm|svg)$/i;

export const isMacroEnabledMime = (mime: string) => /macro/i.test(mime);

export function fileExtension(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** Name, declared type and size only (no bytes). Returns an error message for the user, or null. */
export function validateCrmFileMeta(file: { name: string; size: number; type: string }): string | null {
  if (!file.name || file.name.length > 200) return "The file name is missing or too long.";
  if (file.size <= 0) return "The file is empty.";
  if (file.size > CRM_MAX_FILE_BYTES) return "That file is too large. The limit is 20 MB.";
  const segments = file.name.split(".").slice(1);
  if (segments.some((s) => BLOCKED_SEGMENT.test(s))) {
    return "Executable, script and macro-enabled files cannot be uploaded.";
  }
  if (isMacroEnabledMime(file.type)) return "Macro-enabled files cannot be uploaded.";
  const ext = fileExtension(file.name);
  const allowed = CRM_ALLOWED_FILE_TYPES.find((t) => t.ext === ext);
  if (!allowed) return `That file type is not allowed. Allowed: ${CRM_ALLOWED_FILE_SUMMARY}.`;
  if (allowed.mime !== file.type) return "The file's type does not match its name.";
  return null;
}

const startsWith = (bytes: Uint8Array, sig: readonly number[]) => sig.every((b, i) => bytes[i] === b);
const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const n = needle.length;
  outer: for (let i = 0; i + n <= bytes.length; i++) {
    for (let j = 0; j < n; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    return true;
  }
  return false;
}

const OOXML_PART: Record<string, string> = { docx: "word/", xlsx: "xl/", pptx: "ppt/" };

/**
 * Checks the file's actual leading bytes against what it claims to be, and rejects executables and macro payloads.
 * Call after validateCrmFileMeta. Returns an error message for the user, or null.
 */
export function inspectCrmFileBytes(bytes: Uint8Array, ext: string): string | null {
  if (bytes.length === 0) return "The file is empty.";
  // Executables of any platform, whatever the file is called.
  if (startsWith(bytes, [0x4d, 0x5a]) || startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(bytes, [0xcf, 0xfa, 0xed, 0xfe]) ||
      startsWith(bytes, [0xca, 0xfe, 0xba, 0xbe]) || startsWith(bytes, [0x23, 0x21])) {
    return "Executable and script files cannot be uploaded.";
  }
  switch (ext) {
    case "pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? null : "This does not look like a real PDF.";
    case "png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? null : "This does not look like a real PNG image.";
    case "jpg":
    case "jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]) ? null : "This does not look like a real JPEG image.";
    case "webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP" ? null : "This does not look like a real WebP image.";
    case "docx":
    case "xlsx":
    case "pptx": {
      if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return "This does not look like a real Office file.";
      // File names inside a zip are stored in plain text in its headers, so these checks need no unzipping.
      if (containsAscii(bytes, "vbaProject") || containsAscii(bytes, "vbaData") || containsAscii(bytes, "macrosheets/")) {
        return "Files containing macros cannot be uploaded.";
      }
      if (!containsAscii(bytes, "[Content_Types].xml") || !containsAscii(bytes, OOXML_PART[ext] ?? "")) {
        return "This does not look like a real Office file.";
      }
      return null;
    }
    case "txt":
    case "csv": {
      const head = bytes.slice(0, 8192);
      if (head.includes(0)) return "This does not look like a text file.";
      const text = new TextDecoder("utf-8", { fatal: false }).decode(head).toLowerCase();
      if (/<script|<html|<\?php/.test(text)) return "Script and web-page content cannot be uploaded.";
      return null;
    }
    default:
      return "That file type is not allowed.";
  }
}

/** Safe file-name for a storage path (letters, digits, dot, dash, underscore only; length-limited). */
export function sanitizeCrmFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-150);
  return cleaned || "file";
}

/** Storage path: `<company_id>/<opportunity_id>/<file_uuid>-<safe name>` — matches the crm_files path CHECK. */
export function buildCrmStoragePath(companyId: string, opportunityId: string, fileId: string, name: string): string {
  return `${companyId}/${opportunityId}/${fileId}-${sanitizeCrmFileName(name)}`;
}

/** Links must be https and well-formed (matches crm_files_link_shape). Returns an error message or null. */
export function validateCrmLink(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return "That does not look like a web address.";
  }
  if (u.protocol !== "https:") return "Only secure (https) links can be added.";
  if (!u.hostname.includes(".")) return "That does not look like a web address.";
  if (/\s/.test(raw.trim())) return "That does not look like a web address.";
  return null;
}
