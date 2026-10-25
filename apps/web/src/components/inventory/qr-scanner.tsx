"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, CameraOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserDeps, cameraSupport, classifyCameraError, decodeVideoFrame, openRearCamera, stopStream, type CameraProblem, type ScanDeps } from "./scan-engine";

const PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied: "The camera is blocked for this site. Allow the camera in the browser settings, or type the code below.",
  unavailable: "No camera was found on this device. Type the code below instead.",
  unsupported: "This browser or page cannot use the camera (the camera needs a secure https page). Type the code below instead.",
  failed: "The camera could not be started. Try again, or type the code below.",
};

/**
 * Scan a label. The camera starts only when the person presses the button, uses the rear camera and never the microphone, stores and
 * uploads nothing, and is released the moment the scanner closes, the tab is hidden or the page is left. Typing the code always works.
 * It only reports what was read (`onRead`); the page decides what that means and never changes stock from a scan alone.
 */
export function QrScanner({ onRead, onClose, deps, autoStart = false }: { onRead: (raw: string) => void; onClose?: () => void; deps?: ScanDeps; autoStart?: boolean }) {
  const id = useId();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRef = useRef<{ raw: string; at: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<"idle" | "starting" | "scanning" | "problem">("idle");
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [typed, setTyped] = useState("");
  const activeDeps = useRef<ScanDeps>(deps ?? {});
  const loopRef = useRef<() => void>(() => undefined);
  // The browser's camera objects are read when the camera starts, never during render.
  useEffect(() => {
    activeDeps.current = deps ?? browserDeps();
  });

  const stop = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const loop = useCallback(() => {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    const d = activeDeps.current;
    Promise.resolve(d.decode ? d.decode(video) : decodeVideoFrame(video, (canvasRef.current ??= document.createElement("canvas"))))
      .then((raw) => {
        if (!streamRef.current) return;
        const now = Date.now();
        // The same code read again within a moment is the same scan, never two.
        if (raw && !(lastRef.current && lastRef.current.raw === raw && now - lastRef.current.at < 1500)) {
          lastRef.current = { raw, at: now };
          onRead(raw);
        } else if (raw && lastRef.current) {
          lastRef.current.at = now;
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (streamRef.current) timerRef.current = setTimeout(() => loopRef.current(), 140);
      });
  }, [onRead]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const start = useCallback(async () => {
    stop();
    setProblem(null);
    if (cameraSupport(activeDeps.current) !== "ok") {
      setProblem("unsupported");
      setPhase("problem");
      return;
    }
    setPhase("starting");
    try {
      const stream = await openRearCamera(activeDeps.current);
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play().catch(() => undefined);
      setPhase("scanning");
      loop();
    } catch (e) {
      stop();
      setProblem(classifyCameraError(e));
      setPhase("problem");
    }
  }, [loop, stop]);

  // Release the camera when the scanner closes, the tab goes to the background, or the page is left.
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") {
        stop();
        setPhase((p) => (p === "scanning" || p === "starting" ? "idle" : p));
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, [stop]);

  useEffect(() => {
    if (autoStart) queueMicrotask(() => void start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    stop();
    setPhase("idle");
    onClose?.();
  };

  return (
    <div className="space-y-3">
      <div className={phase === "scanning" || phase === "starting" ? "overflow-hidden rounded-md border border-border bg-black" : "hidden"}>
        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" aria-label="Camera view" playsInline muted />
      </div>
      {phase === "starting" ? <p role="status" className="text-sm text-muted-foreground">Starting the camera…</p> : null}
      {phase === "scanning" ? <p role="status" className="text-sm text-muted-foreground">Point the camera at the label. Nothing is saved or uploaded.</p> : null}
      {phase === "problem" && problem ? <Alert variant="warning" role="status">{PROBLEM_TEXT[problem]}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {phase === "scanning" || phase === "starting" ? (
          <Button type="button" variant="outline" onClick={close}><CameraOff className="h-4 w-4" aria-hidden /> Stop camera</Button>
        ) : (
          <Button type="button" onClick={() => void start()}><Camera className="h-4 w-4" aria-hidden /> {phase === "problem" ? "Try the camera again" : "Use the camera"}</Button>
        )}
        {onClose && phase !== "scanning" && phase !== "starting" ? <Button type="button" variant="ghost" onClick={close}>Close</Button> : null}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) {
            onRead(typed.trim());
            setTyped("");
          }
        }}
      >
        <div className="min-w-[12rem] flex-1">
          <label htmlFor={`${id}-code`} className="mb-1 block text-[13px] font-medium text-muted-foreground">Or type the code on the label</label>
          <Input id={`${id}-code`} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. UAE-E-00042" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit" variant="secondary" disabled={!typed.trim()}>Look up</Button>
      </form>
    </div>
  );
}
