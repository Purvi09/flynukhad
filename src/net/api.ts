// The server, from the browser's side.

import type { CityData, LatLon, TileData } from "@shared/geo";

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const post = async <T,>(url: string, body: unknown, timeoutMs: number): Promise<T> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(String((data as { error?: string; reason?: string }).error ?? (data as { reason?: string }).reason ?? `HTTP ${response.status}`), response.status);
  return data as T;
};

export const buildCity = (city: string) => post<CityData>("/api/city", { city }, 120_000);

export const fetchTile = (centre: LatLon, cx: number, cy: number) =>
  post<TileData>("/api/tile", { centre, tile: { cx, cy } }, 90_000);

export type Moderation =
  | { ok: true; text: string; edited: boolean; checked: boolean }
  | { ok: false; reason: string };

export const moderateMemory = async (input: { text: string; place: string; city: string; photo?: string }): Promise<Moderation> => {
  try {
    return await post<Moderation>("/api/moderate", input, 60_000);
  } catch (caught) {
    if (caught instanceof ApiError) return { ok: false, reason: caught.message };
    return { ok: false, reason: "Could not reach the server. Try again in a moment." };
  }
};

export const streetViewUrl = (lat: number, lon: number) => `/api/streetview?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`;
