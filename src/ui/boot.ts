// The first screen: the title, who you are, and which city.
//
// Three steps rather than one form. The title screen has to do the work of
// saying what this is — a book of places, not a flight simulator — so it gets
// the photographs and the whole viewport, and nothing is asked on it.

import { cleanName, clear, el, stored } from "./dom";
import { cityscape } from "./cityscape";
import type { Memory } from "../net/memories";

export const HULLS = [
  { id: "rose", colour: 0xd4708f },
  { id: "amber", colour: 0xe8a33c },
  { id: "moss", colour: 0x5f9160 },
  { id: "sky", colour: 0x5b8fc4 },
  { id: "violet", colour: 0x8a6fb8 },
  { id: "clay", colour: 0xc4634f },
  { id: "bone", colour: 0xe9e2d0 },
  { id: "ink", colour: 0x2e3a4a },
];

const SUGGESTIONS = ["Lisbon", "Indiranagar, Bangalore", "Old Delhi", "Shibuya, Tokyo", "Brooklyn Heights", "Le Marais, Paris", "Fort Kochi"];

export type BootChoice = { city: string; name: string; hull: number };

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;

/** A little portrait of the pod, painted the way the real one is lit. */
const podSvg = (hull: number) => `
<svg viewBox="0 0 48 40" aria-hidden="true">
  <ellipse cx="24" cy="35" rx="13" ry="2.6" fill="#000" opacity="0.14"/>
  <path d="M9 22 Q9 12 24 12 Q39 12 39 22 Q39 30 24 30 Q9 30 9 22 Z" fill="${hex(hull)}"/>
  <path d="M9 22 Q9 12 24 12 Q39 12 39 22 Z" fill="#fff" opacity="0.22"/>
  <path d="M17 19 Q17 15 24 15 Q31 15 31 19 Q31 22 24 22 Q17 22 17 19 Z" fill="#2e3a4a" opacity="0.55"/>
  <path d="M18 18 Q19 16 24 16 Q27 16 28 17 Z" fill="#fff" opacity="0.5"/>
  <circle cx="13" cy="27" r="2.1" fill="#ffd08a"/>
  <circle cx="35" cy="27" r="2.1" fill="#ffd08a"/>
</svg>`;

type Step = "title" | "you" | "where";

const STEPS: Array<{ id: Step; label: string }> = [
  { id: "you", label: "You" },
  { id: "where", label: "Your city" },
];

type Options = {
  /** Someone arrived through a link to a memory: show it, and pre-fill the city. */
  arrival?: { memory: Memory; city: string } | null;
  onGo: (choice: BootChoice, report: (text: string, isError?: boolean) => void) => Promise<void>;
};

export class Boot {
  readonly root: HTMLElement;
  private status: HTMLElement;
  private cityInput: HTMLInputElement;
  private nameInput: HTMLInputElement;
  private goButton: HTMLButtonElement;
  private looks: HTMLElement;
  private stage: HTMLElement;
  private hull = HULLS[0].colour;
  private step: Step = "title";
  private city = cityscape();

  constructor(private options: Options) {
    this.status = el("div", { class: "status" });

    this.cityInput = el("input", {
      class: "field", placeholder: "A city, or the neighbourhood you grew up in",
      autocomplete: "off", autocapitalize: "words",
    });
    this.cityInput.value = options.arrival?.city ?? stored.get("city", "");

    this.nameInput = el("input", { class: "field", placeholder: "First name", maxlength: "20", autocomplete: "given-name" });
    this.nameInput.value = stored.get("name", "");

    this.looks = el("div", { class: "looks" });
    const savedHull = Number(stored.get("hull", ""));
    if (HULLS.some((h) => h.colour === savedHull)) this.hull = savedHull;
    this.renderLooks();

    this.goButton = el("button", { class: "btn primary", type: "submit" }, "Fly there") as HTMLButtonElement;

    this.stage = el("div", { class: "boot-stage" });
    this.root = el("div", { class: "boot" }, this.city.root, this.stage);
    this.render();
  }

  // ---- the three screens ------------------------------------------------------

  private progress() {
    const at = STEPS.findIndex((s) => s.id === this.step);
    return el("div", { class: "boot-steps" },
      ...STEPS.map((s, i) => el("span", {
        class: `boot-step${s.id === this.step ? " on" : i < at ? " done" : ""}`,
      }, s.label)),
    );
  }

  private titleScreen() {
    const arrival = this.options.arrival;
    return el("div", { class: "boot-hero" },
      el("p", { class: "boot-brand" }, "Nukkad · a map of what people remember"),
      el("h1", { class: "boot-title" },
        el("span", {}, "Every place"),
        el("span", {}, "remembers ", el("em", {}, "something"), "."),
      ),
      arrival
        ? el("p", { class: "boot-lede arrival" },
          el("b", {}, arrival.memory.by || "Someone"),
          ` left a memory near ${arrival.memory.place || "here"}, in ${arrival.city}. Give a name, and you will be flying over it.`)
        : el("p", { class: "boot-lede" },
          "Fly the street you grew up on, drawn from open map data. Find the memories people have left at the places they happened — a corner, a bench, a doorway — and leave your own. When you want more, the city has its own history to find."),
      el("div", { class: "boot-actions" },
        el("button", {
          class: "btn primary big", type: "button",
          onclick: () => { this.step = "you"; this.render(); },
        }, arrival ? "Go there" : "Start exploring"),
      ),
      el("p", { class: "boot-foot" },
        "Google Maps shows you where places are. Wikipedia tells you what happened there. This shows you what people remember there."),
    );
  }

  private youScreen() {
    return el("div", { class: "boot-card" },
      this.progress(),
      el("div", { class: "panel" },
        el("p", { class: "panel-title" }, "What should people call you"),
        el("p", { class: "panel-note" },
          "A first name. It is shown on any memory you leave, so whoever finds it knows a person was there — nothing else about you is stored."),
        this.nameInput,
        el("p", { class: "panel-title spaced" }, "And your pod"),
        this.looks,
        el("div", { class: "actions" },
          el("div", { class: "left" },
            el("button", { class: "btn small ghost", type: "button", onclick: () => { this.step = "title"; this.render(); } }, "Back")),
          el("button", { class: "btn primary", type: "button", onclick: () => this.toWhere() }, "Next"),
        ),
      ),
    );
  }

  private whereScreen() {
    const chips = el("div", { class: "chips" },
      ...SUGGESTIONS.map((s) => el("button", {
        class: "chip", type: "button",
        onclick: () => { this.cityInput.value = s; void this.go(); },
      }, s)));

    return el("form", {
      class: "boot-card",
      onsubmit: (e: Event) => { e.preventDefault(); void this.go(); },
    },
      this.progress(),
      el("div", { class: "panel" },
        el("p", { class: "panel-title" }, "Where are we going"),
        el("p", { class: "panel-note" },
          "Anywhere real. A whole city, or the few streets you actually know."),
        this.cityInput,
        chips,
        el("div", { class: "actions" },
          el("div", { class: "left" },
            el("button", { class: "btn small ghost", type: "button", onclick: () => { this.step = "you"; this.render(); } }, "Back")),
          this.goButton,
        ),
        this.status,
      ),
      el("div", { class: "fine" },
        el("div", {}, "Mouse to steer, ", el("kbd", {}, "W"), " to fly, ", el("kbd", {}, "Space"), " and ", el("kbd", {}, "C"), " to rise and dive, ", el("kbd", {}, "Shift"), " to boost."),
        el("div", {}, "Streets, buildings and trees come from OpenStreetMap. Memories are moderated before anyone sees them. First names only."),
      ),
    );
  }

  private render() {
    clear(this.stage);
    this.root.classList.toggle("boot--hero", this.step === "title");
    this.stage.append(
      this.step === "title" ? this.titleScreen()
        : this.step === "you" ? this.youScreen()
        : this.whereScreen(),
    );
    if (this.step === "you") setTimeout(() => this.nameInput.focus(), 50);
    if (this.step === "where") setTimeout(() => this.cityInput.focus(), 50);
  }

  private toWhere() {
    if (!cleanName(this.nameInput.value)) {
      this.nameInput.focus();
      this.nameInput.classList.add("bad");
      setTimeout(() => this.nameInput.classList.remove("bad"), 800);
      return;
    }
    this.step = "where";
    this.render();
    // A link already says which city: go straight there.
    if (this.options.arrival && this.cityInput.value) void this.go();
  }

  private renderLooks() {
    clear(this.looks);
    for (const h of HULLS) {
      this.looks.append(el("button", {
        type: "button",
        class: `look${h.colour === this.hull ? " on" : ""}`,
        title: h.id,
        "aria-label": `${h.id} pod`,
        html: podSvg(h.colour),
        onclick: () => { this.hull = h.colour; this.renderLooks(); },
      }));
    }
  }

  report = (text: string, isError = false) => {
    this.status.textContent = text;
    this.status.classList.toggle("error", isError);
  };

  private async go() {
    const city = this.cityInput.value.trim();
    const name = cleanName(this.nameInput.value);
    if (city.length < 2) { this.report("Name a city first.", true); this.cityInput.focus(); return; }
    if (!name) { this.step = "you"; this.render(); return; }
    stored.set("city", city);
    stored.set("name", name);
    stored.set("hull", String(this.hull));
    this.goButton.disabled = true;
    this.cityInput.disabled = true;
    this.report("Finding the place…");
    try {
      await this.options.onGo({ city, name, hull: this.hull }, this.report);
    } catch (caught) {
      this.report(caught instanceof Error ? caught.message : "Something went wrong.", true);
    } finally {
      this.goButton.disabled = false;
      this.cityInput.disabled = false;
    }
  }

  remove() { this.city.stop(); this.root.remove(); }
}
