// A typed place name to a point on the earth. Google first, Nominatim as fallback.

import type { LatLon } from "../shared/geo";

export type Place = { centre: LatLon; label: string };

const UA = "nukkad/0.2 (educational project)";
const MAPS_KEY = () => process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

/**
 * Google's geocoder resolves "Bhilwara" to the town rather than the district,
 * and copes with misspellings and local names.
 */
const geocodeGoogle = async (query: string): Promise<Place | null> => {
  const key = MAPS_KEY();
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("language", "en");
  url.searchParams.set("key", key);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const data = await response.json() as { status?: string; error_message?: string; results?: Array<{ geometry?: { location?: { lat: number; lng: number } }; formatted_address?: string }> };
    if (data.status === "REQUEST_DENIED") {
      warnOnce(`Google geocoding refused: ${data.error_message ?? "request denied"}. Falling back to Nominatim.`);
      return null;
    }
    const result = data.results?.[0];
    const loc = result?.geometry?.location;
    if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
    return { centre: { lat: loc.lat, lon: loc.lng }, label: String(result?.formatted_address ?? query) };
  } catch {
    return null;
  }
};

/**
 * Nominatim ranks the *district* above the *town* of the same name, and the
 * district's coordinate is the centroid of farmland. Take the settlement.
 */
const SETTLEMENT = new Set(["city", "town", "village", "suburb", "neighbourhood", "quarter", "hamlet", "borough", "city_district"]);

const geocodeNominatim = async (query: string): Promise<Place | null> => {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "en");
  const response = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "en" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Could not reach the geocoder.");
  const results = await response.json() as Array<{ class?: string; type?: string; lat: string; lon: string; display_name?: string }>;
  if (!Array.isArray(results) || results.length === 0) return null;
  const rank = (r: { class?: string; type?: string }) =>
    r.class === "place" && SETTLEMENT.has(r.type ?? "") ? 0 : r.class === "place" ? 1 : r.class === "boundary" ? 3 : 2;
  const best = [...results].sort((a, b) => rank(a) - rank(b))[0];
  return { centre: { lat: parseFloat(best.lat), lon: parseFloat(best.lon) }, label: String(best.display_name ?? query) };
};

const warned = new Set<string>();
const warnOnce = (message: string) => { if (!warned.has(message)) { warned.add(message); console.warn(message); } };

const cache = new Map<string, Place | null>();

export const geocode = async (query: string): Promise<Place | null> => {
  const key = query.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  const place = (await geocodeGoogle(query)) ?? (await geocodeNominatim(query));
  if (place) cache.set(key, place);
  return place;
};

/** A short label from a long geocoder string: "Lisbon, Portugal" not the whole address. */
export const shortLabel = (label: string) => {
  const parts = label.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 2) return label;
  return `${parts[0]}, ${parts[parts.length - 1]}`;
};
