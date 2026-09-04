// The real Street View photograph of a spot, proxied so the Maps key never
// reaches the browser, and so a place with no coverage is a clean 404 rather
// than Google's grey "no imagery" placeholder.

const KEY = () => process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

type Meta = { status: string; location?: { lat: number; lng: number }; date?: string; error_message?: string };
let warnedDenied = false;

const bearing = (from: { lat: number; lng: number }, to: { lat: number; lon: number }) => {
  const p1 = (from.lat * Math.PI) / 180;
  const p2 = (to.lat * Math.PI) / 180;
  const dl = ((to.lon - from.lng) * Math.PI) / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

export const streetViewConfigured = () => Boolean(KEY());

export type StreetViewResult =
  | { ok: true; bytes: ArrayBuffer; contentType: string; date: string }
  | { ok: false; status: number; error: string };

export const streetView = async (lat: number, lon: number): Promise<StreetViewResult> => {
  const key = KEY();
  if (!key) return { ok: false, status: 501, error: "No Maps key configured." };
  try {
    const metaResponse = await fetch(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lon}&radius=90&key=${key}`,
      { signal: AbortSignal.timeout(12_000) },
    );
    const meta = (await metaResponse.json()) as Meta;
    if (meta.status === "REQUEST_DENIED" && !warnedDenied) {
      warnedDenied = true;
      console.warn(`Street View refused: ${meta.error_message ?? "request denied"}. Photographs are off until the Maps key's project has billing.`);
    }
    if (meta.status !== "OK" || !meta.location) return { ok: false, status: 404, error: "no imagery here" };

    const heading = Math.round(bearing(meta.location, { lat, lon }));
    const image = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${lat},${lon}` +
      `&heading=${heading}&fov=85&pitch=6&radius=90&source=outdoor&return_error_code=true&key=${key}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!image.ok) return { ok: false, status: 404, error: "no imagery here" };
    return {
      ok: true,
      bytes: await image.arrayBuffer(),
      contentType: image.headers.get("content-type") ?? "image/jpeg",
      date: meta.date ?? "",
    };
  } catch {
    return { ok: false, status: 502, error: "street view unavailable" };
  }
};
