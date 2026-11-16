import { describe, expect, it } from "vitest";
import { inspectUploadBytes, MAX_UPLOAD_BYTES, sanitizeForStoragePath, validateUploadMeta } from "./upload-rules";

const meta = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({ name: "scan.pdf", size: 2 * 1024 * 1024, type: "application/pdf", ...over });

describe("upload rules (what the screens say is what is enforced)", () => {
  it("allows PDF, JPEG, PNG and WebP up to exactly 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
    for (const [name, type] of [["a.pdf", "application/pdf"], ["a.jpg", "image/jpeg"], ["a.jpeg", "image/jpeg"], ["a.png", "image/png"], ["a.webp", "image/webp"]] as const) {
      expect(validateUploadMeta(meta({ name, type, size: MAX_UPLOAD_BYTES }))).toBeNull();
    }
  });
  it("refuses empty, over 10 MB, other types, executables, double extensions and a name that does not match its type", () => {
    expect(validateUploadMeta(meta({ size: 0 }))).toMatch(/empty/);
    expect(validateUploadMeta(meta({ size: MAX_UPLOAD_BYTES + 1 }))).toMatch(/too large/);
    expect(validateUploadMeta(meta({ name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toMatch(/Only PDF/);
    expect(validateUploadMeta(meta({ name: "a.exe", type: "application/x-msdownload" }))).toMatch(/Only PDF/);
    expect(validateUploadMeta(meta({ name: "a.exe.pdf" }))).toMatch(/Executable/);
    expect(validateUploadMeta(meta({ name: "a.png" }))).toMatch(/does not match/);
    expect(validateUploadMeta(meta({ name: "noextension" }))).toMatch(/Only PDF/);
    expect(validateUploadMeta(meta({ name: "x".repeat(201) + ".pdf" }))).toMatch(/too long/);
  });
  it("checks the leading bytes against the declared type and always refuses executables", () => {
    const b = (...n: number[]) => Uint8Array.from(n);
    expect(inspectUploadBytes(b(0x25, 0x50, 0x44, 0x46, 0x2d, 1), "application/pdf")).toBeNull();
    expect(inspectUploadBytes(b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), "image/png")).toBeNull();
    expect(inspectUploadBytes(b(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBeNull();
    expect(inspectUploadBytes(b(0x4d, 0x5a, 0x90, 0), "application/pdf")).toMatch(/Executable/);
    expect(inspectUploadBytes(b(0xff, 0xd8, 0xff), "application/pdf")).toMatch(/real PDF/);
    expect(inspectUploadBytes(b(1, 2, 3), "text/plain")).toMatch(/Only PDF/);
  });
  it("cleans a name for a storage path", () => {
    expect(sanitizeForStoragePath("my visa (final).pdf")).toBe("my_visa__final_.pdf");
  });
});
