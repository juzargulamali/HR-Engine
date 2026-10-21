import QRCode from "qrcode";
import { labelPayload } from "@enginious-hr/domain";

export type LabelSize = "small" | "medium" | "large";
export const LABEL_SIZES: Record<LabelSize, { label: string; widthMm: number; heightMm: number; qrMm: number }> = {
  small: { label: "Small (50 × 30 mm)", widthMm: 50, heightMm: 30, qrMm: 24 },
  medium: { label: "Medium (70 × 40 mm)", widthMm: 70, heightMm: 40, qrMm: 32 },
  large: { label: "Large (100 × 60 mm)", widthMm: 100, heightMm: 60, qrMm: 50 },
};

export interface LabelData {
  /** The stable record code (UAE-E-00042 for a unit, UAE-S-00007 for an item in a bin). The only thing the QR carries. */
  code: string;
  /** A short name for people: item name, and the bin for a quantity label. Never a price, a person or an access credential. */
  name: string;
  /** A second small line, e.g. the location or the bin. Optional. */
  detail?: string;
}

/** The QR as inline SVG text. Black on white with the standard quiet zone so a phone reads it from a sticker. */
export async function labelQrSvg(siteUrl: string, code: string): Promise<string> {
  return QRCode.toString(labelPayload(siteUrl, code), { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } });
}

/** Shortens a name so it stays readable on a small sticker without hiding which item it is (the code is the identity). */
export function conciseName(name: string, max = 42): string {
  const clean = name.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A printable sheet of labels: QR, the readable ID in large type and a concise name. Print-ready CSS (page margins, one label per cell,
 * no page break inside a label). Rendered on the server; the page's Print button calls window.print().
 */
export function LabelSheet({ labels, svgs, size }: { labels: readonly LabelData[]; svgs: Readonly<Record<string, string>>; size: LabelSize }) {
  const s = LABEL_SIZES[size];
  return (
    <div className="label-sheet" data-size={size}>
      <style>{`
        .label-sheet { display: flex; flex-wrap: wrap; gap: 3mm; }
        .label-cell { box-sizing: border-box; width: ${s.widthMm}mm; height: ${s.heightMm}mm; padding: 2mm; display: flex; align-items: center; gap: 2mm;
          background: #fff; color: #000; border: 0.3mm dashed #999; break-inside: avoid; page-break-inside: avoid; overflow: hidden; }
        .label-qr { flex: none; width: ${s.qrMm}mm; height: ${s.qrMm}mm; }
        .label-qr svg { width: 100%; height: 100%; display: block; }
        .label-text { min-width: 0; line-height: 1.15; }
        .label-code { font: 700 ${size === "small" ? "10" : size === "medium" ? "13" : "20"}pt/1.1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.02em; word-break: break-all; }
        .label-name { margin-top: 1mm; font: 500 ${size === "small" ? "7.5" : size === "medium" ? "9" : "13"}pt/1.2 system-ui, sans-serif; overflow-wrap: anywhere; }
        .label-detail { margin-top: 0.5mm; font: 400 ${size === "small" ? "6.5" : size === "medium" ? "7.5" : "10"}pt/1.2 system-ui, sans-serif; color: #333; }
        @media print {
          @page { margin: 8mm; }
          body * { visibility: hidden; }
          .label-sheet, .label-sheet * { visibility: visible; }
          .label-sheet { position: absolute; left: 0; top: 0; gap: 0; }
          .label-cell { border-color: transparent; }
        }
      `}</style>
      {labels.map((l) => (
        <div key={l.code} className="label-cell" data-code={l.code}>
          <div className="label-qr" role="img" aria-label={`QR code for ${l.code}`} dangerouslySetInnerHTML={{ __html: svgs[l.code] ?? "" }} />
          <div className="label-text">
            <div className="label-code">{l.code}</div>
            <div className="label-name">{conciseName(l.name)}</div>
            {l.detail ? <div className="label-detail">{conciseName(l.detail, 36)}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
