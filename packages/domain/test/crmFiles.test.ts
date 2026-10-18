import { describe, expect, it } from "vitest";
import { buildCrmStoragePath, inspectCrmFileBytes, sanitizeCrmFileName, validateCrmFileMeta, validateCrmLink, CRM_MAX_FILE_BYTES } from "../src";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === "string" ? [...enc(p)] : p)));
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("CRM file metadata validation", () => {
  it("accepts the allowed types with a matching content type", () => {
    expect(validateCrmFileMeta({ name: "po.pdf", size: 1000, type: "application/pdf" })).toBeNull();
    expect(validateCrmFileMeta({ name: "brief.docx", size: 1000, type: DOCX })).toBeNull();
    expect(validateCrmFileMeta({ name: "site.JPG", size: 1000, type: "image/jpeg" })).toBeNull();
  });
  it.each(["setup.exe", "run.bat", "x.cmd", "a.scr", "a.msi", "a.js", "a.vbs", "a.ps1", "a.sh", "a.jar", "a.dll", "a.lnk", "a.hta", "page.html", "pic.svg"])("rejects %s", (name) => {
    expect(validateCrmFileMeta({ name, size: 10, type: "application/octet-stream" })).toMatch(/Executable|not allowed/);
  });
  it.each(["budget.xlsm", "brief.docm", "deck.pptm", "t.dotm", "t.xltm", "t.xlam", "t.xlsb", "t.ppsm"])("rejects macro-enabled %s", (name) => {
    expect(validateCrmFileMeta({ name, size: 10, type: "application/vnd.ms-excel.sheet.macroEnabled.12" })).toMatch(/macro|Executable/i);
  });
  it("rejects a double extension that hides an executable", () => {
    expect(validateCrmFileMeta({ name: "invoice.exe.pdf", size: 10, type: "application/pdf" })).toMatch(/Executable/);
    expect(validateCrmFileMeta({ name: "invoice.pdf.exe", size: 10, type: "application/pdf" })).toMatch(/Executable/);
  });
  it("rejects a macro content type even under an innocent name", () => {
    expect(validateCrmFileMeta({ name: "sheet.xlsx", size: 10, type: "application/vnd.ms-excel.sheet.macroEnabled.12" })).toMatch(/Macro/);
  });
  it("rejects a type that does not match the name, unknown types, empty and oversize files", () => {
    expect(validateCrmFileMeta({ name: "a.pdf", size: 10, type: "image/png" })).toMatch(/does not match/);
    expect(validateCrmFileMeta({ name: "a.mp4", size: 10, type: "video/mp4" })).toMatch(/not allowed/);
    expect(validateCrmFileMeta({ name: "a.pdf", size: 0, type: "application/pdf" })).toMatch(/empty/);
    expect(validateCrmFileMeta({ name: "a.pdf", size: CRM_MAX_FILE_BYTES + 1, type: "application/pdf" })).toMatch(/too large/);
    expect(validateCrmFileMeta({ name: "noextension", size: 10, type: "application/pdf" })).toMatch(/not allowed/);
  });
});

describe("CRM file content inspection", () => {
  it("accepts genuine signatures", () => {
    expect(inspectCrmFileBytes(bytes("%PDF-1.7\n"), "pdf")).toBeNull();
    expect(inspectCrmFileBytes(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "xxxx"), "png")).toBeNull();
    expect(inspectCrmFileBytes(bytes([0xff, 0xd8, 0xff, 0xe0], "xxxx"), "jpg")).toBeNull();
    expect(inspectCrmFileBytes(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "), "webp")).toBeNull();
    expect(inspectCrmFileBytes(bytes("PK\x03\x04", "[Content_Types].xml", "word/document.xml"), "docx")).toBeNull();
    expect(inspectCrmFileBytes(bytes("Name,Value\nA,1\n"), "csv")).toBeNull();
  });
  it("rejects executables renamed to look harmless", () => {
    expect(inspectCrmFileBytes(bytes("MZ\x90\x00"), "pdf")).toMatch(/Executable/);
    expect(inspectCrmFileBytes(bytes([0x7f, 0x45, 0x4c, 0x46]), "png")).toMatch(/Executable/);
    expect(inspectCrmFileBytes(bytes("#!/bin/sh\nrm -rf /"), "txt")).toMatch(/Executable/);
  });
  it("rejects a PDF that is not a PDF", () => {
    expect(inspectCrmFileBytes(bytes("<html>"), "pdf")).toMatch(/real PDF/);
  });
  it("rejects Office files carrying macros even when named .docx/.xlsx", () => {
    expect(inspectCrmFileBytes(bytes("PK\x03\x04", "[Content_Types].xml", "word/document.xml", "word/vbaProject.bin"), "docx")).toMatch(/macros/);
    expect(inspectCrmFileBytes(bytes("PK\x03\x04", "[Content_Types].xml", "xl/workbook.xml", "xl/vbaProject.bin"), "xlsx")).toMatch(/macros/);
    expect(inspectCrmFileBytes(bytes("PK\x03\x04", "[Content_Types].xml", "xl/macrosheets/sheet1.xml"), "xlsx")).toMatch(/macros/);
  });
  it("rejects a zip that is not the Office format it claims", () => {
    expect(inspectCrmFileBytes(bytes("PK\x03\x04", "readme.txt"), "docx")).toMatch(/real Office/);
    expect(inspectCrmFileBytes(bytes("PK\x03\x04", "[Content_Types].xml", "word/document.xml"), "xlsx")).toMatch(/real Office/);
  });
  it("rejects binary or script content in text files", () => {
    expect(inspectCrmFileBytes(Uint8Array.from([65, 0, 66]), "txt")).toMatch(/text file/);
    expect(inspectCrmFileBytes(bytes("<script>alert(1)</script>"), "csv")).toMatch(/Script/);
  });
  it("rejects empty and unknown", () => {
    expect(inspectCrmFileBytes(new Uint8Array(), "pdf")).toMatch(/empty/);
    expect(inspectCrmFileBytes(bytes("abc"), "exe")).toMatch(/not allowed/);
  });
});

describe("CRM storage paths and links", () => {
  it("sanitises names and builds the path the database expects", () => {
    expect(sanitizeCrmFileName("../../etc/pass wd?.pdf")).toBe("_.._etc_pass_wd_.pdf");
  });
  it("builds <company>/<opportunity>/<uuid>-<name>", () => {
    const c = "11111111-1111-4111-8111-111111111111", o = "22222222-2222-4222-8222-222222222222", f = "33333333-3333-4333-8333-333333333333";
    const p = buildCrmStoragePath(c, o, f, "My PO (final).pdf");
    expect(p).toBe(`${c}/${o}/${f}-My_PO_final_.pdf`);
    expect(p).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}-[A-Za-z0-9._-]{1,150}$/);
  });
  it("never lets a name traverse folders", () => {
    expect(sanitizeCrmFileName("../../x.pdf")).not.toContain("/");
    expect(sanitizeCrmFileName("...hidden")).not.toMatch(/^\./);
    expect(sanitizeCrmFileName("")).toBe("file");
  });
  it("accepts https links only", () => {
    expect(validateCrmLink("https://www.canva.com/design/abc")).toBeNull();
    expect(validateCrmLink("http://example.com")).toMatch(/https/);
    expect(validateCrmLink("javascript:alert(1)")).toMatch(/https|web address/);
    expect(validateCrmLink("not a url")).toMatch(/web address/);
    expect(validateCrmLink("https://localhost")).toMatch(/web address/);
  });
});
