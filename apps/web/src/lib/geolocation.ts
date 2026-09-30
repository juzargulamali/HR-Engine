export interface LocationCapture {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  permissionStatus: "granted" | "denied" | "unavailable" | "timeout";
}

/**
 * Fresh browser geolocation for a Site work / Installation clock event (see
 * attendance_locations' own doc comment in schema.sql) — called ONLY at a
 * site_work segment's own start/end, never continuously. Denial,
 * unavailability, or a timeout always resolves (never rejects) with a
 * status the server records verbatim; clocking is never blocked by it.
 */
export function captureLocation(timeoutMs = 10000): Promise<LocationCapture> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ permissionStatus: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          permissionStatus: "granted",
        });
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) resolve({ permissionStatus: "denied" });
        else if (err.code === err.TIMEOUT) resolve({ permissionStatus: "timeout" });
        else resolve({ permissionStatus: "unavailable" });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/**
 * OpenStreetMap — never a paid/keyed map service (no Google Maps API key,
 * no billing account needed for a plain hyperlink like this).
 */
export function mapsLinkFor(latitude: number, longitude: number): string {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`;
}
