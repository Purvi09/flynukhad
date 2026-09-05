// Panels that take over the screen for a moment: reading a memory, leaving
// one, the help sheet, the menu. And the chat drawer, which does not.

import { clear, el, formatDistance, timeAgo } from "./dom";
import type { Memory } from "../net/memories";
import type { ChatLine } from "../net/chat";
import { streetViewUrl } from "../net/api";

const MAX = 400;

type Host = {
  root: HTMLElement;
  /** Tell the game the keyboard is ours (or not). */
  capture: (on: boolean) => void;
};

/** A dimmed backdrop with a panel in it. Returns a function that closes it. */
const modal = (host: Host, panel: HTMLElement, onClose: () => void) => {
  const dim = el("div", { class: "dim", onclick: (e: Event) => { if (e.target === dim) close(); } }, panel);
  host.root.append(dim);
  host.capture(true);
  const close = () => { dim.remove(); host.capture(false); onClose(); };
  return close;
};

// ---- reading a memory -----------------------------------------------------------

export const readMemory = (host: Host, memory: Memory, options: {
  mine: boolean;
  onDelete: () => Promise<boolean>;
  onClose: () => void;
  shareUrl: string;
}) => {
  const photo = memory.photo ? el("img", { class: "photo", src: memory.photo, alt: "A photograph left with this memory", loading: "lazy" }) : null;
  const streetImg = el("img", { alt: "", loading: "lazy" });
  const street = el("div", { class: "street" }, streetImg, el("div", { class: "caption" }, "the street today"));
  street.style.display = "none";
  streetImg.addEventListener("load", () => { street.style.display = ""; });
  streetImg.src = streetViewUrl(memory.lat, memory.lon);

  const copyButton = el("button", { class: "btn small ghost", type: "button", onclick: async () => {
    try {
      await navigator.clipboard.writeText(options.shareUrl);
      copyButton.textContent = "Link copied";
    } catch {
      copyButton.textContent = options.shareUrl;
    }
  } }, "Copy link");

  const actions = el("div", { class: "actions" },
    el("div", { class: "left" }, copyButton),
    options.mine
      ? el("button", { class: "btn small", type: "button", onclick: async (e: Event) => {
        const b = e.currentTarget as HTMLButtonElement;
        if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Really take it down?"; return; }
        b.disabled = true;
        if (await options.onDelete()) close();
        else { b.disabled = false; b.textContent = "Could not delete"; }
      } }, "Take it down")
      : null,
    el("button", { class: "btn small primary", type: "button", onclick: () => close() }, "Close"),
  );

  const panel = el("div", { class: "panel" },
    el("div", { class: "meta" }, el("b", {}, memory.by || "Someone"), " · ", memory.place || "somewhere here", " · ", timeAgo(memory.at),
      memory.sample ? el("span", {}, "· sample") : null),
    el("p", { class: "memory-text" }, memory.text),
    photo,
    street,
    actions,
  );
  const close = modal(host, panel, options.onClose);
  return close;
};

// ---- leaving one --------------------------------------------------------------------

export type Draft = { text: string; photo?: string };

export const composeMemory = (host: Host, options: {
  place: string;
  city: string;
  at: { lat: number; lon: number };
  onPost: (draft: Draft, report: (text: string | null) => void) => Promise<boolean>;
  onClose: () => void;
}) => {
  let photo: string | null = null;
  const area = el("textarea", { class: "field", maxlength: String(MAX), placeholder: "What happened here? Who were you with? What do you still think about?" });
  const count = el("span", { class: "count" }, `0 / ${MAX}`);
  const problem = el("div", { class: "problem" });
  const preview = el("img", { alt: "" });
  preview.style.display = "none";
  const fileInput = el("input", { type: "file", accept: "image/*" });
  fileInput.style.display = "none";
  const attachButton = el("button", { class: "btn small ghost", type: "button", onclick: () => fileInput.click() }, "Add a photo");
  const removePhoto = el("button", { class: "btn small ghost", type: "button", onclick: () => { photo = null; preview.style.display = "none"; removePhoto.style.display = "none"; } }, "Remove");
  removePhoto.style.display = "none";

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        photo = canvas.toDataURL("image/jpeg", 0.82);
        preview.src = photo;
        preview.style.display = "";
        removePhoto.style.display = "";
      };
      image.onerror = () => { problem.textContent = "That file could not be read as an image."; };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  area.addEventListener("input", () => { count.textContent = `${area.value.length} / ${MAX}`; });

  const streetImg = el("img", { alt: "", loading: "lazy" });
  const street = el("div", { class: "street" }, streetImg, el("div", { class: "caption" }, "the street today"));
  street.style.display = "none";
  streetImg.addEventListener("load", () => { street.style.display = ""; });
  streetImg.src = streetViewUrl(options.at.lat, options.at.lon);

  const postButton = el("button", { class: "btn primary", type: "submit" }, "Leave it here");

  const form = el("form", { class: "panel", onsubmit: async (e: Event) => {
    e.preventDefault();
    const text = area.value.trim();
    if (text.length < 12) { problem.textContent = "Say a little more than that."; return; }
    postButton.disabled = true;
    postButton.textContent = "Checking…";
    problem.textContent = "";
    const ok = await options.onPost({ text, photo: photo ?? undefined }, (t) => { problem.textContent = t ?? ""; });
    if (ok) close();
    else { postButton.disabled = false; postButton.textContent = "Leave it here"; }
  } },
    el("h2", {}, "Leave a memory"),
    el("div", { class: "meta" }, "Pinned near ", el("b", {}, options.place), " in ", options.city),
    street,
    area,
    el("div", { class: "attach" }, preview, attachButton, removePhoto, fileInput, count),
    problem,
    el("div", { class: "note" }, "First names only. No phone numbers, handles or addresses. Whoever finds this reads it standing where it happened."),
    el("div", { class: "actions" },
      el("button", { class: "btn", type: "button", onclick: () => close() }, "Not now"),
      postButton,
    ),
  );
  const close = modal(host, form, options.onClose);
  setTimeout(() => area.focus(), 30);
  return close;
};

// ---- help and menu ---------------------------------------------------------------------

export const showHelp = (host: Host, options: {
  city: string;
  muted: boolean;
  onMute: () => boolean;
  onLeaveCity: () => void;
  onClose: () => void;
  counts: { tiles: number; buildings: number; roads: number; memories: number; others: number };
  /** Everyone else in the city right now, and how far off they are. */
  people: Array<{ name: string; coat: number; away: number }>;
}) => {
  const muteButton = el("button", { class: "btn small", type: "button", onclick: () => {
    muteButton.textContent = options.onMute() ? "Sound off" : "Sound on";
  } }, options.muted ? "Sound off" : "Sound on");
  const panel = el("div", { class: "panel" },
    el("h2", {}, "How to fly"),
    el("div", { class: "help-grid" },
      el("kbd", {}, "Mouse"), el("span", {}, "point the nose"),
      el("kbd", {}, "W / S"), el("span", {}, "thrust forward and back"),
      el("kbd", {}, "A / D"), el("span", {}, "strafe"),
      el("kbd", {}, "Space / C"), el("span", {}, "rise and dive"),
      el("kbd", {}, "Shift"), el("span", {}, "boost"),
      el("kbd", {}, "E"), el("span", {}, "read the memory you are next to"),
      el("kbd", {}, "M"), el("span", {}, "leave a memory where you are"),
      el("kbd", {}, "T"), el("span", {}, "city chat"),
      el("kbd", {}, "G"), el("span", {}, "the city's history, and who remembers it"),
      el("kbd", {}, "L"), el("span", {}, "lock this spot in as your answer to the case"),
      el("kbd", {}, "P"), el("span", {}, "the street today, where you are"),
      el("kbd", {}, "Scroll"), el("span", {}, "camera distance"),
      el("kbd", {}, "Esc"), el("span", {}, "release the mouse / this menu"),
    ),
    options.people.length > 0
      ? el("div", {},
        el("p", { class: "eyebrow" }, `Also flying ${options.city.split(",")[0]}`),
        el("ul", { class: "roster" },
          ...[...options.people].sort((a, b) => a.away - b.away).slice(0, 12).map((p) =>
            el("li", {},
              el("span", { class: "dot", style: `background:#${(p.coat >>> 0).toString(16).padStart(6, "0")}` }),
              el("span", {}, p.name || "someone"),
              el("span", { class: "far" }, formatDistance(p.away)),
            )),
        ))
      : null,
    el("div", { class: "note" },
      `${options.city}: ${options.counts.buildings.toLocaleString()} buildings and ${options.counts.roads.toLocaleString()} streets loaded across ${options.counts.tiles} tiles. `,
      `${options.counts.memories} ${options.counts.memories === 1 ? "memory" : "memories"} here, ${options.counts.others} other ${options.counts.others === 1 ? "person" : "people"} flying.`),
    el("div", { class: "actions" },
      el("div", { class: "left" }, muteButton, el("button", { class: "btn small ghost", type: "button", onclick: () => { close(); options.onLeaveCity(); } }, "Another city")),
      el("button", { class: "btn small primary", type: "button", onclick: () => close() }, "Back to it"),
    ),
  );
  const close = modal(host, panel, options.onClose);
  return close;
};

/** The Street View photograph of where you are right now. */
export const showStreetPhoto = (host: Host, at: { lat: number; lon: number }, place: string, onClose: () => void) => {
  const img = el("img", { alt: "The street here today" });
  const note = el("div", { class: "note" }, "Loading the street…");
  img.addEventListener("load", () => { note.textContent = place; });
  img.addEventListener("error", () => { note.textContent = "No Street View photograph here."; img.style.display = "none"; });
  img.src = streetViewUrl(at.lat, at.lon);
  const panel = el("div", { class: "panel" },
    el("h2", {}, "The street today"),
    el("div", { class: "street" }, img),
    note,
    el("div", { class: "actions" }, el("button", { class: "btn small primary", type: "button", onclick: () => close() }, "Close")),
  );
  const close = modal(host, panel, onClose);
  return close;
};

// ---- chat -------------------------------------------------------------------------------

export class ChatDrawer {
  readonly root: HTMLElement;
  private lines: HTMLElement;
  private input: HTMLInputElement;
  private myUid: string | null = null;
  private open = false;

  constructor(private host: Host, city: string, onSend: (text: string) => Promise<void>) {
    this.lines = el("div", { class: "lines" });
    this.input = el("input", { class: "field", placeholder: "Say something to the city", maxlength: "240" });
    const form = el("form", { onsubmit: async (e: Event) => {
      e.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      this.input.disabled = true;
      try { await onSend(text); this.input.value = ""; }
      catch (caught) { this.input.value = text; this.input.placeholder = caught instanceof Error ? caught.message : "Could not send"; }
      finally { this.input.disabled = false; this.input.focus(); }
    } }, this.input, el("button", { class: "btn small primary", type: "submit" }, "Send"));
    this.root = el("div", { class: "chat" },
      el("header", {}, el("span", {}, `${city} · chat`), el("span", {}, "T to close")),
      this.lines,
      form,
    );
    this.root.style.display = "none";
    host.root.append(this.root);
    this.input.addEventListener("focus", () => host.capture(true));
    this.input.addEventListener("blur", () => host.capture(false));
  }

  setUid(uid: string | null) { this.myUid = uid; }

  toggle() {
    this.open = !this.open;
    this.root.style.display = this.open ? "" : "none";
    if (this.open) this.input.focus(); else this.input.blur();
    return this.open;
  }

  get isOpen() { return this.open; }

  set(lines: ChatLine[]) {
    clear(this.lines);
    for (const line of lines) {
      this.lines.append(el("div", { class: line.uid === this.myUid ? "mine" : "" }, el("b", {}, line.name), " ", line.text));
    }
    this.lines.scrollTop = this.lines.scrollHeight;
  }

  remove() { this.root.remove(); }
}
