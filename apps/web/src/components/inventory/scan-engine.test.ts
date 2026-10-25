import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { labelPayload, parseInventoryScan } from "@enginious-hr/domain";
import { cameraSupport, classifyCameraError, decodePixels, openRearCamera, stopStream } from "./scan-engine";

/** Renders a QR code to RGBA pixels the way a camera frame would carry it (black on white with a quiet zone). */
function qrPixels(text: string, scale = 6, quiet = 4) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (qr.modules.get(x, y))
        for (let dy = 0; dy < scale; dy++)
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + quiet) * scale + dy) * size + (x + quiet) * scale + dx) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
  return { data, size };
}

describe("QR decoding (software decoder, the path iPhone Safari uses)", () => {
  it("reads back the label address of a unit and of a bin", () => {
    for (const code of ["UAE-E-00042", "POL-S-00007"]) {
      const payload = labelPayload("https://os.example.com", code);
      const { data, size } = qrPixels(payload);
      const raw = decodePixels(data, size, size);
      expect(raw).toBe(payload);
      expect(parseInventoryScan(raw)).toMatchObject({ ok: true, code });
    }
  });
  it("reads a label that is a little small, and a code printed light on dark", () => {
    const { data, size } = qrPixels("UAE-E-00042", 3);
    expect(decodePixels(data, size, size)).toBe("UAE-E-00042");
    const inverted = Uint8ClampedArray.from(data, (v, i) => (i % 4 === 3 ? 255 : 255 - v));
    expect(decodePixels(inverted, size, size)).toBe("UAE-E-00042");
  });
  it("finds nothing in a blank or noisy frame and does not invent a code", () => {
    expect(decodePixels(new Uint8ClampedArray(200 * 200 * 4).fill(255), 200, 200)).toBeNull();
    const noise = new Uint8ClampedArray(200 * 200 * 4);
    for (let i = 0; i < noise.length; i++) noise[i] = i % 4 === 3 ? 255 : (i * 2654435761) % 256;
    expect(decodePixels(noise, 200, 200)).toBeNull();
  });
});

describe("camera access", () => {
  it("is unsupported on an insecure page or a browser without getUserMedia", () => {
    expect(cameraSupport({ isSecureContext: false, mediaDevices: { getUserMedia: async () => ({}) as MediaStream } })).toBe("unsupported");
    expect(cameraSupport({ isSecureContext: true })).toBe("unsupported");
    expect(cameraSupport({ isSecureContext: true, mediaDevices: { getUserMedia: async () => ({}) as MediaStream } })).toBe("ok");
  });
  it("asks for the rear camera and never the microphone", async () => {
    let asked: MediaStreamConstraints | undefined;
    await openRearCamera({ isSecureContext: true, mediaDevices: { getUserMedia: async (c) => { asked = c; return {} as MediaStream; } } });
    expect(asked?.audio).toBe(false);
    expect(JSON.stringify(asked?.video)).toContain("environment");
  });
  it("names each way the camera can fail", () => {
    expect(classifyCameraError({ name: "NotAllowedError" })).toBe("denied");
    expect(classifyCameraError({ name: "NotFoundError" })).toBe("unavailable");
    expect(classifyCameraError({ name: "TypeError" })).toBe("unsupported");
    expect(classifyCameraError(new Error("boom"))).toBe("failed");
  });
  it("releases every track, and is safe to call twice", () => {
    let stops = 0;
    const stream = { getTracks: () => [{ stop: () => { stops++; } }, { stop: () => { stops++; } }] } as unknown as MediaStream;
    stopStream(stream);
    stopStream(stream);
    stopStream(null);
    expect(stops).toBe(4);
  });
});
