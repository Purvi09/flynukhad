// Checks a memory before it is allowed anywhere near the map.
//
// A memory is a stranger's words pinned to a real place, and it may name a real
// person. That combination is the whole appeal and the whole risk, so the rules
// are deliberately narrow: first names only, no way to identify or contact
// anyone, nothing aimed at a private address.

import { askGeminiJson, geminiConfigured } from "./gemini";

const CONTACT = /(\+?\d[\d\s\-()]{7,}\d)|([\w.+-]+@[\w-]+\.[\w.]{2,})|(\b(?:instagram|whatsapp|telegram|snapchat|facebook|twitter|linkedin|tiktok)\b)|(@[A-Za-z0-9_]{3,})|(https?:\/\/\S+)/i;

export const MIN_TEXT = 12;
export const MAX_TEXT = 400;

export type Verdict =
  | { ok: true; text: string; edited: boolean; checked: boolean }
  | { ok: false; reason: string; status: number };

export type ModerateInput = { text?: string; place?: string; city?: string; photo?: string };

const checkPhoto = async (mime: string, base64: string, caption: string) =>
  askGeminiJson<{ allow?: boolean; reason?: string }>({
    image: { mime, base64 },
    budgetMs: 25_000,
    prompt:
`Someone wants to pin this photograph to a public place on a map, with this caption:
"""${caption}"""

Allow it only if ALL of these hold:
- It is an ordinary personal or place photograph: a street, a building, a view, a group of people, an object, a document.
- It contains no nudity, sexual content, gore, or violence.
- It is not hateful, harassing, or a threat.
- It shows no readable personal information: no ID cards, addresses, number plates in close-up, phone screens with messages, bank details.
- It is not an advertisement or spam.

A photo with recognisable faces is fine; people photograph their friends. Reject only if it looks intended to expose or shame someone.

Return JSON: {"allow":true|false,"reason":"<one short sentence, addressed to the person posting>"}`,
  });

export const moderate = async (body: ModerateInput): Promise<Verdict> => {
  const text = (body.text ?? "").trim().replace(/\s+/g, " ");
  if (text.length < MIN_TEXT) return { ok: false, reason: "Say a little more than that.", status: 400 };
  if (text.length > MAX_TEXT) return { ok: false, reason: `Keep it under ${MAX_TEXT} characters.`, status: 400 };
  if (CONTACT.test(text)) {
    return {
      ok: false, status: 400,
      reason: "Leave out phone numbers, emails and handles. If someone finds this, they can reply to you through here.",
    };
  }

  if (body.photo) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.photo);
    if (!match) return { ok: false, reason: "Photos must be JPEG, PNG or WebP.", status: 400 };
    if (match[2].length > 3_500_000) return { ok: false, reason: "That photo is too large. Under 2 MB please.", status: 400 };
    if (geminiConfigured()) {
      const verdict = await checkPhoto(match[1], match[2], text);
      if (verdict === null) {
        return { ok: false, status: 503, reason: "Could not check the photo right now. Try again in a moment, or post without it." };
      }
      if (!verdict.allow) return { ok: false, status: 422, reason: verdict.reason ?? "That photo cannot be posted." };
    }
  }

  // Without a model we still enforce the mechanical rules above, and say so.
  if (!geminiConfigured()) return { ok: true, text, edited: false, checked: false };

  const verdict = await askGeminiJson<{ allow?: boolean; reason?: string; cleaned?: string }>({
    tier: "cheap",
    timeoutMs: 10_000,
    budgetMs: 18_000,
    prompt:
`You are checking a short memory that someone wants to pin to a public place in ${body.city ?? "a city"}${body.place ? `, near ${body.place}` : ""}. Other people will find it there.

The memory:
"""${text}"""

Allow it only if ALL of these hold:
- It reads as a genuine personal memory or message about a place.
- Any people mentioned are referred to by FIRST NAME ONLY: no surnames, no workplace, no school, nothing that would let a stranger identify them.
- It does not contain contact details, links or social handles.
- It is not abuse, harassment, a threat, sexual content, or an accusation against a named person.
- It does not point at a private home or reveal where someone lives.
- It is not advertising or spam.

A message hoping someone sees it and gets in touch is fine; that is the point, as long as it names no more than a first name.

If it is allowable but has a surname or an identifying detail, set "cleaned" to the same text with only that detail removed. Change nothing else. Never rewrite their voice.

Return JSON: {"allow":true|false,"reason":"<one short sentence, addressed to the writer>","cleaned":"<text or empty>"}`,
  });

  if (!verdict) return { ok: false, status: 503, reason: "Could not check this right now. Please try again in a moment." };
  if (!verdict.allow) return { ok: false, status: 422, reason: verdict.reason ?? "This one cannot be posted." };

  const cleaned = (verdict.cleaned ?? "").trim();
  const usable = cleaned && cleaned.length >= MIN_TEXT && cleaned.length <= MAX_TEXT;
  return { ok: true, text: usable ? cleaned : text, edited: Boolean(usable) && cleaned !== text, checked: true };
};
