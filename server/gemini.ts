// One place to talk to Gemini.
//
// Free-tier quota is per model, so a single busy model dies quickly. This
// rotates across models, remembers which ones are spent, and returns null only
// when every model is out, so the caller can fall back sensibly.

type Ask = {
  prompt: string;
  temperature?: number;
  timeoutMs?: number;
  /** Total wall-clock across the whole rotation; a player is waiting. */
  budgetMs?: number;
  /** Cheap, high-volume calls should start on the smaller models. */
  tier?: "best" | "cheap";
  image?: { mime: string; base64: string };
};

const BEST = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
];
const CHEAP = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3-flash-preview",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
];

const restingUntil = new Map<string, number>();
const QUOTA_REST_MS = 60 * 60 * 1000;
const BUSY_REST_MS = 60 * 1000;

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);

export async function askGeminiJson<T>({
  prompt, temperature, timeoutMs = 20_000, budgetMs = 30_000, tier = "cheap", image,
}: Ask): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const now = Date.now();
  const deadline = now + budgetMs;
  const models = (tier === "cheap" ? CHEAP : BEST).filter((m) => (restingUntil.get(m) ?? 0) <= now);

  for (const model of models) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try {
      const parts: unknown[] = [{ text: prompt }];
      if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.base64 } });
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
          body: JSON.stringify({
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              ...(temperature === undefined ? {} : { temperature }),
            },
          }),
        },
      );
      if (response.status === 429) { restingUntil.set(model, Date.now() + QUOTA_REST_MS); continue; }
      if (response.status === 404) { restingUntil.set(model, Date.now() + 24 * 60 * 60 * 1000); continue; }
      if (response.status >= 500) { restingUntil.set(model, Date.now() + BUSY_REST_MS); continue; }
      if (!response.ok) continue;

      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text === "string" && text.trim()) {
        try { return JSON.parse(text) as T; } catch { continue; }
      }
    } catch {
      restingUntil.set(model, Date.now() + BUSY_REST_MS);
    }
  }
  return null;
}
