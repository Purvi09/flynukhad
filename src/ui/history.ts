// The history game's screens: the file being opened, the case you are on, and
// talking to a witness.

import { clear, el, formatDistance } from "./dom";
import { MAX_POINTS, STAGE_LABEL, verdictFor, type Turn, type Witness } from "@shared/history";
import type { CaseRun, WitnessState } from "../game/cases";
import { askWitness } from "../net/api";

type Host = {
  root: HTMLElement;
  capture: (on: boolean) => void;
};

const modal = (host: Host, panel: HTMLElement, onClose: () => void, variant = "") => {
  const dim = el("div", { class: `dim ${variant}`.trim(), onclick: (e: Event) => { if (e.target === dim) close(); } }, panel);
  host.root.append(dim);
  host.capture(true);
  const close = () => { dim.remove(); host.capture(false); onClose(); };
  return close;
};

// ---- opening the file --------------------------------------------------------------
//
// Reading a city's history takes a few seconds the first time — Overpass, then
// the phrasing — and a bare status line made that look like nothing happened.
// So the wait is the first scene of the case instead: a file being pulled,
// a case picked out of it, corners walked, people found and asked to talk.
// Every stage here is a real step, ticked off when that step actually finishes.

export type CaseStage = "record" | "deal" | "streets" | "cast";

const OPENING: Array<{ id: CaseStage; title: string; lines: string[] }> = [
  {
    id: "record",
    title: "Pulling the city's record",
    lines: [
      "everything that happened within a few streets of here",
      "plaques, ruins, old names, things that burned down",
      "cross-checking what the city admits to",
    ],
  },
  {
    id: "deal",
    title: "Choosing your case",
    lines: [
      "something you have not been given before",
      "far enough from the last one that finding it is work",
      "taking the name out of the clue",
    ],
  },
  {
    id: "streets",
    title: "Walking the streets it touches",
    lines: [
      "measuring corners, bearings, how far is far",
      "picking the spots someone would actually stand",
    ],
  },
  {
    id: "cast",
    title: "Finding people who were there",
    lines: [
      "a shopkeeper, a driver, someone who never left",
      "getting their stories straight",
      "one of them will be honestly mistaken — that is the game",
    ],
  },
];

/** The wait after G: staged, honest, and never silent. */
export const openingCase = (host: Host, options: { city: string; round: number }) => {
  const rows = OPENING.map((stage) => ({
    stage,
    node: el("li", { class: "step step--pending" },
      el("span", { class: "step-mark" }),
      el("div", {},
        el("b", {}, stage.title),
        el("span", { class: "step-line" }, stage.lines[0]),
      ),
    ),
  }));

  const bar = el("i", { class: "opening-fill" });
  const problem = el("p", { class: "problem", style: "display:none" });
  const patience = el("p", { class: "panel-note", style: "display:none" },
    "The first case in a city is the slow one — the record is read once, then it is kept.");

  const panel = el("div", { class: "panel opening" },
    el("header", {},
      el("span", { class: "eyebrow" }, `Case ${options.round}`),
      el("span", { class: "eyebrow" }, options.city),
    ),
    el("h2", {}, "Opening the file"),
    el("div", { class: "opening-bar" }, bar),
    el("ul", { class: "steps" }, ...rows.map((r) => r.node)),
    patience,
    problem,
  );

  const dim = el("div", { class: "dim" }, panel);
  host.root.append(dim);
  host.capture(true);

  let at = 0;
  let tick = 0;
  const paint = () => {
    rows.forEach((row, index) => {
      const state = index < at ? "done" : index === at ? "live" : "pending";
      row.node.className = `step step--${state}`;
      const line = row.node.querySelector(".step-line");
      if (line && index === at) line.textContent = row.stage.lines[tick % row.stage.lines.length];
    });
    bar.style.width = `${Math.round(((at + 0.5) / OPENING.length) * 100)}%`;
  };
  paint();

  // The detail line under the live stage turns over on its own, so a slow
  // request still reads as work being done rather than a frozen screen.
  const turning = window.setInterval(() => { tick += 1; paint(); }, 2200);
  const waited = window.setTimeout(() => { patience.style.display = ""; }, 9000);

  const stop = () => { window.clearInterval(turning); window.clearTimeout(waited); };
  const close = () => { stop(); dim.remove(); host.capture(false); };

  return {
    /** Say that everything before `stage` is finished and it is now the live one. */
    step(stage: CaseStage) {
      const index = OPENING.findIndex((s) => s.id === stage);
      if (index > at) { at = index; tick = 0; paint(); }
    },
    /** Leave the message up under a dead file rather than closing on a blank screen. */
    fail(message: string) {
      stop();
      at = OPENING.length;
      paint();
      problem.textContent = message;
      problem.style.display = "";
      patience.style.display = "none";
      panel.append(el("div", { class: "actions" },
        el("button", { class: "btn small", type: "button", onclick: () => close() }, "Close"),
      ));
    },
    close,
  };
};

// ---- the case you are on -----------------------------------------------------------

export const showCase = (host: Host, run: CaseRun, options: {
  round: number;
  total: number;
  found: number;
  /** Points banked across the set so far. */
  score: number;
  /** Where the player is, so the panel can say how far the witnesses are. */
  at: { x: number; y: number };
  onGiveUp: () => void;
  onNext: () => void;
  /** Put the whole thing down and go back to flying. */
  onLeave: () => void;
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
      el("span", { class: "eyebrow" }, `${options.score} pts · ${options.found} dead on`),
    ),
    solved
      ? el("div", { class: "case-answer" },
        el("p", { class: "case-verdict" },
          run.surrendered ? "You let this one go." : verdictFor(run.away ?? 0)),
        el("h2", {}, site.title),
        // how far the answer you gave was from the answer, and what that paid
        run.away !== null
          ? el("div", { class: "tally" },
            el("div", { class: "tally-away" },
              el("b", {}, formatDistance(run.away)),
              el("span", {}, "from where you locked in"),
            ),
            el("div", { class: `tally-points${run.points === 0 ? " tally-points--none" : ""}` },
              el("b", {}, `+${run.points}`),
              el("span", {}, `of ${MAX_POINTS}`),
            ),
          )
          : null,
        el("p", { class: "case-summary" }, site.summary),
        el("p", { class: "panel-note" },
          run.guess
            ? "Look behind this: the gold pole is the place, and the dashes run back to where you called it. It is on your map too."
            : "Look behind this: the gold pole is the place. It is on your map too."),
        el("a", { class: "btn small ghost", href: site.url, target: "_blank", rel: "noreferrer" }, "Read about it"),
      )
      : el("div", {},
        el("p", { class: "case-era" }, site.era === "undated" ? "Date unknown" : site.era),
        el("p", { class: "case-clue" }, site.clue),
        el("p", { class: "panel-note" },
          run.witnesses.length > 0
            ? "Four people know a piece of where this is. Fly to one and press E to talk. Each will point you to the next — but one of them is honestly mistaken."
            : "No one is out on the streets for this one. You are on your own: fly to the spot the clue describes."),
        el("p", { class: "case-lock" },
          el("kbd", {}, "L"), " locks in wherever you are as your answer. ",
          el("span", {}, "The closer you are when you do, the more it is worth — so it pays to ask around first.")),
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
        // the way out of the game entirely, back to just flying the city
        el("button", { class: "btn small ghost quiet", type: "button", onclick: () => { options.onLeave(); close(); } },
          "Leave the game"),
      ),
      solved
        ? el("button", { class: "btn small primary", type: "button", onclick: () => { options.onNext(); close(); } },
          options.round >= options.total ? "Finish" : "Next case")
        : el("button", { class: "btn small", type: "button", onclick: () => close() }, "Keep looking"),
    ),
  );

  // an answered case sits low and lets the light through: the reveal is
  // happening on the ground behind it and is the better half of the moment
  const close = modal(host, panel, options.onClose, solved ? "dim--answer" : "");
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
  score: number;
  city: string;
  onAgain: () => void;
  onClose: () => void;
}) => {
  const best = options.total * MAX_POINTS;
  const share = best > 0 ? options.score / best : 0;
  const panel = el("div", { class: "panel" },
    el("span", { class: "eyebrow" }, "The city, as far as it will tell you"),
    el("h2", {}, `${options.score} points`),
    el("p", { class: "case-verdict" },
      `${options.found} of ${options.total} dead on · ${best} was the most there was`),
    el("p", { class: "panel-note" },
      share >= 0.9
        ? `You have ${options.city} by heart. There is more history here than this — it is simply not written down yet.`
        : share >= 0.5
          ? `Good ground covered. The misses were the ones where you stopped asking too early.`
          : options.score === 0
            ? `Nothing landed this time. The witnesses are worth the detour: each one narrows it a good deal.`
            : `${options.city} keeps the rest of its history to itself, for now.`),
    el("div", { class: "actions" },
      el("div", { class: "left" }),
      el("button", { class: "btn small primary", type: "button", onclick: () => { options.onAgain(); close(); } }, "Deal another set"),
    ),
  );
  const close = modal(host, panel, options.onClose);
  return close;
};
