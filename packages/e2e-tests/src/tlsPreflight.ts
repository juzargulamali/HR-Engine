import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { URL } from "node:url";

/**
 * Independent strict TLS verification, deliberately NOT using Chromium:
 * this exists specifically because Chromium's own certificate verifier is
 * confirmed broken in this container (see config.ts's
 * isBrowserTlsBypassAllowed doc comment) — this is the check that still
 * catches a REAL certificate problem (expired, wrong host, genuinely
 * untrusted) before any test trusts the browser-side bypass that works
 * around the container defect. `rejectUnauthorized` is never set to false
 * here; this path must fail exactly like a normal, unmodified HTTPS client
 * would on a real certificate problem.
 *
 * Only returns/logs the safe fields a security report needs (hostname,
 * authorized, protocol, issuer, expiry) — never headers, cookies, tokens,
 * or other environment values.
 */
export interface TlsPreflightResult {
  hostname: string;
  authorized: boolean;
  protocol: string | null;
  issuer?: string;
  validTo?: string;
  authorizationError?: string;
}

/** This sandbox's outbound HTTPS goes through a local CONNECT proxy (see
 * /root/.ccr/README.md) — a bare tls.connect straight to the target host
 * doesn't reach it. Tunnel through HTTPS_PROXY exactly like a normal HTTPS
 * client would, then verify the TLS session over that tunnel. If no proxy
 * is configured, connects directly. */
function tunnelOrDirectSocket(hostname: string, port: number): Promise<import("node:net").Socket> {
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxyUrl) {
    return new Promise((resolve, reject) => {
      const socket = netConnect(port, hostname);
      socket.once("connect", () => resolve(socket));
      socket.once("error", reject);
    });
  }
  const proxy = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const socket = netConnect(Number(proxy.port), proxy.hostname);
    socket.once("connect", () => {
      socket.write(`CONNECT ${hostname}:${port} HTTP/1.1\r\nHost: ${hostname}\r\n\r\n`);
    });
    socket.once("data", (data) => {
      const response = data.toString("utf8", 0, Math.min(data.length, 64));
      if (!response.includes("200")) {
        reject(new Error(`Proxy CONNECT to ${hostname}:${port} failed: ${response.split("\r\n")[0]}`));
        return;
      }
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

export async function strictTlsCheck(hostname: string, port = 443, timeoutMs = 15_000): Promise<TlsPreflightResult> {
  try {
    const rawSocket = await tunnelOrDirectSocket(hostname, port);
    return await new Promise<TlsPreflightResult>((resolve) => {
      const tlsSocket = tlsConnect(
        {
          socket: rawSocket,
          servername: hostname,
          rejectUnauthorized: true, // never relaxed — this is the real check
          timeout: timeoutMs,
        },
        () => {
          const cert = tlsSocket.getPeerCertificate();
          resolve({
            hostname,
            authorized: tlsSocket.authorized,
            protocol: tlsSocket.getProtocol(),
            issuer: cert?.issuer ? Object.entries(cert.issuer).map(([k, v]) => `${k}=${v}`).join(", ") : undefined,
            validTo: cert?.valid_to,
            authorizationError: tlsSocket.authorized ? undefined : String(tlsSocket.authorizationError ?? "unknown"),
          });
          tlsSocket.end();
        },
      );
      tlsSocket.on("error", (err) => {
        resolve({ hostname, authorized: false, protocol: null, authorizationError: err.message });
      });
      tlsSocket.setTimeout(timeoutMs, () => {
        tlsSocket.destroy();
        resolve({ hostname, authorized: false, protocol: null, authorizationError: "timeout" });
      });
    });
  } catch (err) {
    return { hostname, authorized: false, protocol: null, authorizationError: err instanceof Error ? err.message : String(err) };
  }
}

/** Logs only the safe fields — see the module doc comment. */
export function logTlsPreflightResult(result: TlsPreflightResult): void {
  // eslint-disable-next-line no-console
  console.log(
    `[tls-preflight] host=${result.hostname} authorized=${result.authorized} protocol=${result.protocol ?? "n/a"}` +
      (result.issuer ? ` issuer="${result.issuer}"` : "") +
      (result.validTo ? ` validTo="${result.validTo}"` : "") +
      (result.authorizationError ? ` error="${result.authorizationError}"` : ""),
  );
}
