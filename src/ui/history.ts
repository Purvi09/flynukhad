// The history game's screens: the case you are on, and talking to a witness.

import { clear, el, formatDistance } from "./dom";
import { STAGE_LABEL, type Turn, type Witness } from "@shared/history";
import type { CaseRun, WitnessState } from "../game/cases";
import { askWitness } from "../net/api";

type Host = {
  root: HTMLElement;
  capture: (on: boolean) => void;
};

const modal = (host: Host, panel: HTMLElement, onClose: () => void) => {
  const dim = el("div", { class: "dim", onclick: (e: Event) => { if (e.target === dim) close(); } }, panel);
  host.root.append(dim);
  host.capture(true);
  const close = () => { dim.remove(); host.capture(false); onClose(); };
  return close;
};

// ---- the case you are on -----------------------------------------------------------

export const showCase = (host: Host, run: CaseRun, options: {
  round: number;
  total: number;
  found: number;
  /** Where the player is, so the panel can say how far the witnesses are. */
  at: { x: number; y: number };
  onGiveUp: () => void;
  onNext: () => void;
  onClose: () => void;
}) => {
  const { site } = run;

  const witnessRow = (state: WitnessState) => {
    const w = state.witness;
    const away = Math.hypot(w.x - options.at.x, w.y - options.at.y);
    const status = state.told ? "told" : state.unlocked ? "waiting" : "locked";
    return el("li", { class: `witness witness--${status}` },
      el("div", { class: "witness-who" },
        el("b", {}, state.unlocked ? w.name : "Someone else"),
        el("span", { class: "witness-role" }, state.unlocked ? w.role : "knows more, once you have asked around"),
      ),
      el("div", { class: "witness-where" },
        state.unlocked ? (w.street ? `on ${w.street}` : w.setting) : "somewhere in the city",
        state.unlocked ? ` · ${formatDistance(away)}` : "",
      ),
      el("div", { class: "witness-stage" }, STAGE_LABEL[w.fact.kind]),
    );
  };

  const solved = run.solved;
  const panel = el("div", { class: "panel case" },
    el("header", {},
      el("span", { class: "eyebrow" }, `Case ${options.round} of ${options.total}`),
      el("span", { class: "eyebrow" }, `${options.found} found`),
    ),
    solved
      ? el("div", { class: "case-answer" },
        el("p", { class: "case-verdict" }, run.surrendered ? "You let this one go." : "Found it."),
        el("h2", {}, site.title),
        el("p", { class: "case-summary" }, site.summary),
        el("a", { class: "btn small ghost", href: site.url, target: "_blank", rel: "noreferrer" }, "Read about it"),
      )
      : el("div", {},
        el("p", { class: "case-era" }, site.era === "undated" ? "Date unknown" : site.era),
        el("p", { class: "case-clue" }, site.clue),
        el("p", { class: "panel-note" },
          run.witnesses.length > 0
            ? "Four people know a piece of where this is. Fly to one and press E to talk. Each will point you to the next — but one of them is honestly mistaken."
            : "No one is out on the streets for this one. You are on your own: fly to the spot the clue describes."),
        run.witnesses.length > 0 ? el("ul", { class: "witnesses" }, ...run.witnesses.map(witnessRow)) : null,
      ),
    el("div", { class: "actions" },
      el("div", { class: "left" },
        !solved
          ? el("button", { class: "btn small ghost", type: "button", onclick: (e: Event) => {
            const b = e.currentTarget as HTMLButtonElement;
            if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Give up and show me?"; return; }
            options.onGiveUp();
            close();
          } }, "I can't find it")
          : null,
      ),
      solved
        ? el("button", { class: "btn small primary", type: "button", onclick: () => { options.onNext(); close(); } },
          options.round >= options.total ? "Finish" : "Next case")
        : el("button", { class: "btn small", type: "button", onclick: () => close() }, "Keep looking"),
    ),
  );

  const close = modal(host, panel, options.onClose);
  return close;
};

// ---- talking to one of them ---------------------------------------------------------

export const talkToWitness = (host: Host, state: WitnessState, options: {
  /** Who sent the player here, so the witness can warm to the name. */
  sentBy: string | null;
  onTold: () => void;
  onClose: () => void;
}) => {
  const w = state.witness;
  const lines = el("div", { class: "lines" });
  const input = el("input", { class: "field", placeholder: `Ask ${w.name} something`, maxlength: "240", autocomplete: "off" });
  const send = el("button", { class: "btn small primary", type: "submit" }, "Ask") as HTMLButtonElement;

  const draw = () => {
    clear(lines);
    for (const turn of state.turns) {
      lines.append(el("div", { class: turn.from === "player" ? "said mine" : "said" },
        el("b", {}, turn.from === "player" ? "You" : w.name), " ", turn.text));
    }
    lines.scrollTop = lines.scrollHeight;
  };

  // They say their opener once, the first time you approach.
  if (state.turns.length === 0) state.turns.push({ from: "witness", text: w.opener });
  draw();

  const ask = async (question: string) => {
    state.turns.push({ from: "player", text: question });
    draw();
    const thinking = el("div", { class: "said thinking" }, el("b", {}, w.name), " …");
    lines.append(thinking);
    lines.scrollTop = lines.scrollHeight;

    try {
      const answer = await askWitness({
        witness: {
          name: w.name, role: w.role,
          standing: w.street ? `on ${w.street}, ${w.setting}` : w.setting,
          testimony: w.testimony, opener: w.opener,
          sentBy: options.sentBy, pointer: w.pointer,
        },
        history: state.turns.slice(0, -1) as Turn[],
        question,
        told: state.told,
      });
      thinking.remove();
      state.turns.push({ from: "witness", text: answer.reply });
      // Once they have given it up, the next person in the chain will talk.
      if (answer.revealed && !state.told) {
        state.told = true;
        if (w.pointer) state.turns.push({ from: "witness", text: w.pointer });
        options.onTold();
      }
      draw();
    } catch {
      thinking.remove();
      // The server is unreachable; give them the plain truth rather than nothing.
      state.turns.push({ from: "witness", text: w.testimony });
      if (!state.told) { state.told = true; options.onTold(); }
      draw();
    }
  };

  const form = el("form", { onsubmit: async (e: Event) => {
    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    input.disabled = true;
    send.disabled = true;
    try { await ask(question); }
    finally { input.disabled = false; send.disabled = false; input.focus(); }
  } }, input, send);

  const hints = el("div", { class: "hints" },
    ...["What happened here?", "Which way is it?", "How far?"].map((q) =>
      el("button", { class: "chip", type: "button", onclick: () => { input.value = q; form.requestSubmit(); } }, q)),
  );

  const panel = el("div", { class: "panel talk" },
    el("header", {},
      el("div", {},
        el("b", {}, w.name),
        el("span", { class: "witness-role" }, ` · ${w.role}`),
      ),
      el("span", { class: "eyebrow" }, STAGE_LABEL[w.fact.kind]),
    ),
    el("p", { class: "panel-note" }, w.look),
    lines,
    hints,
    form,
  );

  const close = modal(host, panel, options.onClose);
  input.addEventListener("focus", () => host.capture(true));
  setTimeout(() => input.focus(), 40);
  return close;
};

// ---- the run is over ------------------------------------------------------------------

export const showScore = (host: Host, options: {
  found: number;
  total: number;
  city: string;
  onAgain: () => void;
  onClose: () => void;
}) => {
  const panel = el("div", { class: "panel" },
    el("span", { class: "eyebrow" }, "The city, as far as it will tell you"),
    el("h2", {}, `${options.found} of ${options.total} found`),
    el("p", { class: "panel-note" },
      options.found === options.total
        ? `You found every one of them in ${options.city}. There is more history than this here — it is simply not written down yet.`
        : options.found === 0
          ? `None found this time. The witnesses are worth talking to: each one narrows it a good deal.`
          : `${options.city} keeps the rest of its history to itself, for now.`),
    el("div", { class: "actions" },
      el("div", { class: "left" }),
      el("button", { class: "btn small primary", type: "button", onclick: () => { options.onAgain(); close(); } }, "Deal another set"),
    ),
  );
  const close = modal(host, panel, options.onClose);
  return close;
};
