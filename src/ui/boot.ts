// The first screen: which city, who you are, what colour your pod is.

import { cleanName, clear, el, stored } from "./dom";
import type { Memory } from "../net/memories";

export const HULLS = [
  { id: "amber", colour: 0xe8a33c },
  { id: "rose", colour: 0xd4708f },
  { id: "moss", colour: 0x5f9160 },
  { id: "sky", colour: 0x5b8fc4 },
  { id: "violet", colour: 0x8a6fb8 },
  { id: "clay", colour: 0xc4634f },
  { id: "bone", colour: 0xe9e2d0 },
  { id: "ink", colour: 0x2e3a4a },
];

const SUGGESTIONS = ["Lisbon", "Indiranagar, Bangalore", "Old Delhi", "Shibuya, Tokyo", "Brooklyn Heights", "Le Marais, Paris", "Fort Kochi"];

export type BootChoice = { city: string; name: string; hull: number };

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
  private hull = HULLS[0].colour;
  private swatches: HTMLElement;

  constructor(private options: Options) {
    this.status = el("div", { class: "status" });
    this.cityInput = el("input", {
      class: "field", placeholder: "A city, or the neighbourhood you grew up in", autocomplete: "off", autocapitalize: "words",
    });
    this.cityInput.value = options.arrival?.city ?? stored.get("city", "");
    this.nameInput = el("input", { class: "field", placeholder: "First name", maxlength: "20", autocomplete: "given-name" });
    this.nameInput.value = stored.get("name", "");
    this.swatches = el("div", { class: "swatches" });
    const savedHull = Number(stored.get("hull", ""));
    if (HULLS.some((h) => h.colour === savedHull)) this.hull = savedHull;
    this.renderSwatches();

    this.goButton = el("button", { class: "btn primary", onclick: () => void this.go() }, "Fly") as HTMLButtonElement;

    const chips = el("div", { class: "chips" },
      ...SUGGESTIONS.map((s) => el("button", { class: "chip", type: "button", onclick: () => { this.cityInput.value = s; void this.go(); } }, s)));

    const arrival = options.arrival
      ? el("div", { class: "arrival" },
        el("b", {}, options.arrival.memory.by || "Someone"), ` left a memory near ${options.arrival.memory.place || "here"} in ${options.arrival.city}. `,
        "Fly there and you will find it glowing where it happened.")
      : null;

    this.root = el("div", { class: "boot" },
      el("form", { class: "boot-card", onsubmit: (e: Event) => { e.preventDefault(); void this.go(); } },
        el("h1", {}, "Nuk", el("span", {}, "had")),
        el("p", { class: "tagline" },
          "Fly any real city, drawn street for street from open map data. Find the memories people left where they happened, and leave your own."),
        arrival,
        el("label", {}, "Where", this.cityInput, chips),
        el("label", {}, "Who you are", this.nameInput),
        el("label", {}, "Your pod", this.swatches),
        el("div", { class: "row" }, this.goButton),
        this.status,
        el("div", { class: "fine" },
          el("div", {}, "Mouse to steer, ", el("kbd", {}, "W"), " to fly, ", el("kbd", {}, "Space"), " and ", el("kbd", {}, "C"), " to rise and dive, ", el("kbd", {}, "Shift"), " to boost."),
          el("div", {}, "Streets, buildings and trees come from OpenStreetMap. Memories are moderated before anyone sees them. First names only."),
        ),
      ),
    );
    setTimeout(() => (this.cityInput.value ? this.nameInput : this.cityInput).focus(), 50);
  }

  private renderSwatches() {
    clear(this.swatches);
    for (const h of HULLS) {
      const swatch = el("button", {
        type: "button",
        class: `swatch${h.colour === this.hull ? " on" : ""}`,
        title: h.id,
        style: `background:#${h.colour.toString(16).padStart(6, "0")}`,
        onclick: () => { this.hull = h.colour; this.renderSwatches(); },
      });
      this.swatches.append(swatch);
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
    if (!name) { this.report("A first name, so a stranger finds a person and not a note.", true); this.nameInput.focus(); return; }
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

  remove() { this.root.remove(); }
}
