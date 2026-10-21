import jsQR from "jsqr";

/**
 * Camera and QR decoding for the in-app scanner. Nothing here stores, uploads or records a frame: a frame is drawn to a small canvas,
 * read for a QR code and thrown away. Only the rear camera is requested and never the microphone. jsQR (a small open-source decoder)
 * reads the frame itself, so it works in iPhone Safari and Android Chrome even where the browser's own BarcodeDetector is missing.
 */

export type CameraProblem = "denied" | "unavailable" | "unsupported" | "failed";

export interface ScanDeps {
  /** Normally navigator.mediaDevices. */
  mediaDevices?: Pick<MediaDevices, "getUserMedia"> | undefined;
  /** Normally window.isSecureContext: browsers only allow the camera on https (or localhost). */
  isSecureContext?: boolean;
  /** Replaces frame decoding (tests only). */
  decode?: (video: HTMLVideoElement) => Promise<string | null> | string | null;
}

export function browserDeps(): ScanDeps {
  if (typeof window === "undefined") return {};
  return { mediaDevices: navigator.mediaDevices, isSecureContext: window.isSecureContext };
}

/** Can this browser even try? Insecure pages and browsers without getUserMedia are "unsupported"; the typed-code box still works. */
export function cameraSupport(deps: ScanDeps): "ok" | "unsupported" {
  if (deps.isSecureContext === false) return "unsupported";
  if (!deps.mediaDevices || typeof deps.mediaDevices.getUserMedia !== "function") return "unsupported";
  return "ok";
}

export function classifyCameraError(e: unknown): CameraProblem {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError") return "unavailable";
  if (name === "TypeError") return "unsupported";
  return "failed";
}

/** Asks for the rear camera only when called (the person pressed Scan). No audio, ever. */
export async function openRearCamera(deps: ScanDeps): Promise<MediaStream> {
  if (cameraSupport(deps) !== "ok") throw Object.assign(new Error("unsupported"), { name: "TypeError" });
  return deps.mediaDevices!.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
}

/** Releases the camera: the light goes off and nothing keeps running. Safe to call twice. */
export function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {
      // already stopped
    }
  });
}

/** Reads a QR code from raw RGBA pixels (also used by the tests with a generated code). */
export function decodePixels(data: Uint8ClampedArray, width: number, height: number): string | null {
  const result = jsQR(data, width, height, { inversionAttempts: "attemptBoth" });
  return result && result.data ? result.data : null;
}

type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> };
let nativeDetector: BarcodeDetectorLike | null | undefined;
function getNativeDetector(): BarcodeDetectorLike | null {
  if (nativeDetector !== undefined) return nativeDetector;
  const Ctor = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  try {
    nativeDetector = Ctor ? new Ctor({ formats: ["qr_code"] }) : null;
  } catch {
    nativeDetector = null;
  }
  return nativeDetector;
}

/** One frame of a playing video: the browser's own detector when there is one, jsQR otherwise. Returns the raw text or null. */
export async function decodeVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<string | null> {
  if (video.readyState < 2 || !video.videoWidth) return null;
  const native = getNativeDetector();
  if (native) {
    try {
      const found = await native.detect(video);
      if (found[0]?.rawValue) return found[0].rawValue;
    } catch {
      // fall through to the software decoder
    }
  }
  const scale = Math.min(1, 640 / video.videoWidth);
  const w = Math.max(1, Math.round(video.videoWidth * scale));
  const h = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, w, h);
  return decodePixels(ctx.getImageData(0, 0, w, h).data, w, h);
}
