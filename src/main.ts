// nukkad: fly a real city, find the memories people left where they
// happened, leave your own.
//
// This file wires the pieces together. Each piece knows nothing about the
// others: the tile streamer draws, the pod flies, the beacons glow, the UI
// asks and tells. Everything meets here.

import "./ui/styles.css";
import * as THREE from "three";
import { citySlug, toLatLon, toMetres, WORLD_LIMIT_M, type CityData } from "@shared/geo";
import { Input, type Action, type Intent } from "./engine/input";
import { Loop } from "./engine/loop";
import { buildCity } from "./net/api";
import { firebaseReady, currentUid } from "./net/firebase";
import { getMemory, isMine, listMemories, moderateMemoryAndSave, rehome, removeMemory, watchMemories, type Memory } from "./net/memoryFlow";
import { joinCity, watchCity, type Explorer } from "./net/presence";
import { chatAvailable, sendChat, watchChat } from "./net/chat";
import { SceneView, AFTERNOON } from "./scene/renderer";
import { allMeshes, loadLantern, loadPod, loadTree, paintedPod, preparedLantern } from "./scene/models";
import { Beacons } from "./scene/beacons";
import { Others } from "./scene/others";
import { WitnessMarks } from "./scene/witnessMarks";
import { Reveal } from "./scene/reveal";
import { TileStreamer } from "./world/tiles";
import { HistoryGame } from "./game/cases";
import { openingCase, showCase, showScore, talkToWitness } from "./ui/history";
import { WITNESS_WITHIN_M } from "@shared/history";
import { Pod } from "./player/pod";
import { FollowCamera } from "./player/camera";
import { Boot, type BootChoice } from "./ui/boot";
import { Hud } from "./ui/hud";
import { formatDistance } from "./ui/dom";
import { ChatDrawer, composeMemory, readMemory, showHelp, showStreetPhoto } from "./ui/panels";
import { TouchControls, isTouchDevice } from "./ui/touch";
import { bumpSound, clickSound, initSound, nearSound, openSound, postSound, setHum, soundMuted, toggleMuted } from "./audio/sound";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLElement;
const MAJOR = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);

type Session = {
  city: CityData;
  choice: BootChoice;
  stop: () => void;
};

let session: Session | null = null;

// ---- arrival through a link -----------------------------------------------------

const arrivalFromUrl = async (): Promise<{ memory: Memory; city: string } | null> => {
  const id = new URLSearchParams(location.search).get("m");
  if (!id) return null;
  const memory = await getMemory(id);
  if (!memory || typeof memory.lat !== "number") return null;
  // the city by name first: it is usually already built. If the memory turns
  // out to lie beyond that map's edge, the city is rebuilt around the memory.
  const label = memory.city.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return { memory, city: label };
};

/** A city that surely contains the memory: the named one, or one built around the spot. */
const buildCityFor = async (query: string, memory: Memory | null): Promise<CityData> => {
  const city = await buildCity(query);
  if (!memory) return city;
  const at = toMetres(city.centre, memory.lat, memory.lon);
  if (Math.hypot(at.x, at.y) < WORLD_LIMIT_M - 300) return city;
  return buildCity(`${query.split("@")[0].trim()} @${memory.lat.toFixed(5)},${memory.lon.toFixed(5)}`);
};

// ---- boot --------------------------------------------------------------------------

const showBoot = async () => {
  const arrival = await arrivalFromUrl().catch(() => null);
  const boot = new Boot({
    arrival,
    onGo: async (choice, report) => {
      initSound();
      report("Asking OpenStreetMap for the streets… (a new city takes 10–30 s)");
      const [city, podModel, treeModel, lanternModel] = await Promise.all([
        buildCityFor(choice.city, arrival?.memory ?? null),
        loadPod(), loadTree(), loadLantern(),
      ]);
      report("Raising the buildings…");
      await new Promise((r) => setTimeout(r, 30));
      boot.remove();
      startSession(city, choice, { pod: podModel, tree: treeModel, lantern: lanternModel }, arrival?.memory ?? null);
    },
  });
  ui.append(boot.root);
};

// ---- a session in a city --------------------------------------------------------------

const startSession = (
  city: CityData,
  choice: BootChoice,
  models: { pod: THREE.Group; tree: THREE.Group; lantern: THREE.Group },
  arrival: Memory | null,
) => {
  const slug = citySlug(city.label);
  const cleanups: Array<() => void> = [];

  // scene
  const view = new SceneView(canvas, AFTERNOON);
  const tiles = new TileStreamer(city, allMeshes(models.tree));
  view.scene.add(tiles.group);
  const pod = new Pod();
  pod.setModel(paintedPod(models.pod, choice.hull));
  view.scene.add(pod.object);
  const beacons = new Beacons(preparedLantern(models.lantern), tiles.world);
  view.scene.add(beacons.group);
  const others = new Others(models.pod);
  view.scene.add(others.group);
  const witnessMarks = new WitnessMarks(tiles.world);
  view.scene.add(witnessMarks.group);
  const reveal = new Reveal();
  view.scene.add(reveal.group);
  const camera = new FollowCamera(view.aspect);

  // input and ui
  const input = new Input(canvas);
  const hud = new Hud(() => input.lockPointer());
  ui.append(hud.root);
  const host = { root: ui, capture: (on: boolean) => input.setCaptured(on) };
  const touch = isTouchDevice() ? new TouchControls(ui, input, (a) => handleAction(a)) : null;
  if (touch) hud.setPointerHint(false);
  const chat = new ChatDrawer(host, city.label, (text) => sendChat(slug, choice.name, text));
  if (!chatAvailable()) chat.remove();
  void currentUid().then((uid) => chat.setUid(uid));
  tiles.onStatus = (text) => hud.setStatus(text);

  // where to start
  const start = (() => {
    if (arrival) {
      // the memory's stored metres belong to whatever centre it was left against;
      // its latitude and longitude do not move
      const at = toMetres(city.centre, arrival.lat, arrival.lon);
      const dz = 45;
      const alt = (typeof arrival.alt === "number" ? arrival.alt : 0) + 12;
      return { x: at.x, y: alt, z: at.y + dz, yaw: 0 };
    }
    return { x: 0, y: 28, z: 60, yaw: 0 };
  })();
  tiles.prime(start.x, start.z);
  let y = start.y;
  while (tiles.world.blocked(start.x, start.z, y) && y < 200) y += 5;
  pod.place(start.x, y + 2, start.z, start.yaw);
  camera.snap(pod.position, pod.quaternion);

  // memories
  let memories: Memory[] = [];
  let closePanel: (() => void) | null = null;
  let nearMemory: Memory | null = null;
  let announced: string | null = null;
  const setMemories = (list: Memory[]) => {
    memories = rehome(list, city.centre);
    beacons.set(memories);
  };
  cleanups.push(watchMemories(city.centre, setMemories));
  void listMemories(city.centre).then(setMemories);

  // other people
  let peopleNow: Explorer[] = [];
  cleanups.push(watchCity(slug, (people) => { peopleNow = people; others.set(people); }));
  void joinCity(slug, { name: choice.name, coat: choice.hull }, () => ({
    x: pod.position.x, y: pod.position.z, alt: pod.position.y, yaw: pod.yaw,
  })).then((leave) => cleanups.push(leave));
  cleanups.push(watchChat(slug, (lines) => chat.set(lines)));

  // the history game
  const game = new HistoryGame(city);
  let loadingCase = false;
  /** Locking in is a one-way door, so the first L only arms it. */
  const ARM_MS = 4000;
  let armedUntil = 0;
  let nearWitness: ReturnType<typeof witnessMarks.nearest> = null;

  /** Who sent the player to this witness, so the name means something to them. */
  const sentBy = (id: string) => {
    const run = game.current;
    if (!run) return null;
    const at = run.witnesses.findIndex((w) => w.witness.id === id);
    return at > 0 ? run.witnesses[at - 1].witness.name : null;
  };

  const drawWitnesses = () => {
    const run = game.current;
    if (!run || run.solved) { witnessMarks.clear(); return; }
    witnessMarks.set(run.witnesses);
  };

  /**
   * Start the next case, or show the score if the set is finished.
   *
   * The wait is shown as it happens: the file panel goes up first and each
   * stage is ticked off as that piece of work actually returns, so pressing G
   * never looks like it did nothing.
   */
  const nextCase = async () => {
    if (loadingCase) return;
    loadingCase = true;
    hideAnswer();
    hud.setStatus("Reading what happened here…");
    // assigned synchronously by openPanel, below
    let opening!: ReturnType<typeof openingCase>;
    openPanel(() => {
      opening = openingCase(host, {
        city: city.label.split(",")[0],
        round: game.roundNumber + 1,
      });
      return opening.close;
    });
    try {
      // the slow one, and only on the first case in a city
      if (!game.ready) opening.step("record");
      await game.load();

      opening.step("deal");
      opening.step("streets");
      // give the two quick stages a beat each, or they flash past unread
      await new Promise((done) => setTimeout(done, 500));
      opening.step("cast");

      const run = await game.next();
      if (!run) {
        openPanel(() => showScore(host, {
          found: game.found, total: game.total, score: game.score,
          city: city.label.split(",")[0],
          onAgain: () => { game.reset(); void nextCase(); },
          onClose: dismiss,
        }));
        return;
      }
      drawWitnesses();
      openSound();
      openPanel(() => openCase());
      // the key only matters from here on, so this is where it is said
      hud.toast("When you think you are standing on it, press L to lock your answer in.", false, 7000);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not gather the city's history.";
      // the panel stays up and says what went wrong, rather than vanishing
      opening.fail(message);
    } finally {
      loadingCase = false;
      hud.setStatus("");
    }
  };

  const openCase = () => {
    const run = game.current;
    if (!run) return () => {};
    return showCase(host, run, {
      round: game.roundNumber, total: game.total, found: game.found, score: game.score,
      at: { x: pod.position.x, y: pod.position.z },
      onGiveUp: () => { game.giveUp(); witnessMarks.clear(); showAnswer(); openPanel(() => openCase()); },
      onNext: () => { void nextCase(); },
      onClose: dismiss,
    });
  };

  /**
   * Answer the case where you are standing. Irreversible, so it takes two
   * presses: the first arms it and says so, the second commits.
   */
  const lockIn = () => {
    const run = game.current;
    if (!run || run.solved) return;
    if (Date.now() > armedUntil) {
      armedUntil = Date.now() + ARM_MS;
      hud.toast("Press L again to lock this spot in as your answer.", false, ARM_MS);
      return;
    }
    armedUntil = 0;
    game.lockIn(pod.position.x, pod.position.z);
    postSound();
    witnessMarks.clear();
    showAnswer();
    hud.toast(`${formatDistance(run.away ?? 0)} out · +${run.points}`, false, 6000);
    // let the camera arrive and the pole land before the file goes up over it
    setTimeout(() => { if (game.current === run) openPanel(() => openCase()); }, 2400);
  };

  // the place you are at, in words
  const whereAmI = () => {
    const x = pod.position.x, z = pod.position.z;
    const street = tiles.world.namedStreet(x, z, 90);
    const place = tiles.world.place(x, z, 45);
    const building = pod.position.y < 60 ? tiles.world.buildingAt(x, z, 3) : null;
    return { street: street?.name ?? null, place: place?.name ?? (building?.name ?? null) };
  };
  const placeLabel = () => {
    const w = whereAmI();
    if (w.place) return w.place;
    if (w.street) return w.street;
    return `somewhere in ${city.label.split(",")[0]}`;
  };

  // actions
  const openPanel = (open: () => () => void) => {
    if (closePanel) closePanel();
    input.unlockPointer();
    closePanel = open();
  };
  const dismiss = () => { closePanel = null; };

  const handleAction = (action: Action) => {
    switch (action) {
      case "read": {
        // a witness in reach takes priority: they are why you flew here
        if (nearWitness) {
          const run = game.current;
          const state = run?.witnesses.find((w) => w.witness.id === nearWitness!.id);
          if (state && !state.unlocked) {
            hud.toast(`${state.witness.name} has nothing for you yet. Ask the others first.`, false, 4000);
            return;
          }
          if (state) {
            openSound();
            openPanel(() => talkToWitness(host, state, {
              sentBy: sentBy(state.witness.id),
              onTold: () => { game.tell(state.witness.id); witnessMarks.refresh(run!.witnesses); },
              onClose: dismiss,
            }));
            return;
          }
        }
        if (!nearMemory) return;
        const memory = nearMemory;
        openSound();
        void isMine(memory).then((mine) => {
          openPanel(() => readMemory(host, memory, {
            mine,
            shareUrl: `${location.origin}${location.pathname}?m=${memory.id}`,
            onDelete: async () => {
              const ok = await removeMemory(memory);
              if (ok) { setMemories(memories.filter((m) => m.id !== memory.id)); hud.toast("Taken down."); }
              return ok;
            },
            onClose: dismiss,
          }));
        });
        return;
      }
      case "leave": {
        const at = toLatLon(city.centre, pod.position.x, pod.position.z);
        const place = placeLabel();
        clickSound();
        openPanel(() => composeMemory(host, {
          place, city: city.label.split(",")[0], at,
          onPost: async (draft, report) => {
            const result = await moderateMemoryAndSave({
              text: draft.text, photo: draft.photo, place, city: city.label,
              centre: city.centre, x: pod.position.x, y: pod.position.z, alt: Math.max(0, pod.position.y - 2.2), by: choice.name,
            });
            if (!result.ok) { report(result.reason); return false; }
            setMemories([result.memory, ...memories]);
            postSound();
            hud.toast(result.edited ? "Left here, with an identifying detail removed." : result.checked ? "Left here. Someone will find it." : "Left here. (Moderation is off: no Gemini key.)");
            if (result.local) hud.toast("Kept in this browser only: Firestore is not reachable.", true, 5000);
            return true;
          },
          onClose: dismiss,
        }));
        return;
      }
      case "chat": {
        if (!chatAvailable()) { hud.toast("Chat needs Firebase configured.", true); return; }
        if (chat.toggle()) input.unlockPointer();
        return;
      }
      case "menu": {
        if (closePanel) { closePanel(); closePanel = null; return; }
        if (chat.isOpen) { chat.toggle(); return; }
        if (input.locked) { input.unlockPointer(); return; }
        handleAction("help");
        return;
      }
      case "help": {
        openPanel(() => showHelp(host, {
          city: city.label, muted: soundMuted(), onMute: toggleMuted,
          counts: { ...tiles.counts, memories: memories.length, others: peopleNow.length },
          people: peopleNow.map((p) => ({
            name: p.name, coat: p.coat,
            away: Math.hypot(p.x - pod.position.x, p.y - pod.position.z),
          })),
          onLeaveCity: () => endSession(),
          onClose: dismiss,
        }));
        return;
      }
      case "history": {
        if (game.current && !game.current.solved) { openPanel(() => openCase()); return; }
        void nextCase();
        return;
      }
      case "lock": {
        lockIn();
        return;
      }
      case "mute": {
        hud.toast(toggleMuted() ? "Sound off" : "Sound on");
        return;
      }
      case "photo": {
        const at = toLatLon(city.centre, pod.position.x, pod.position.z);
        openPanel(() => showStreetPhoto(host, at, placeLabel(), dismiss));
        return;
      }
      case "map":
        return;
    }
  };
  cleanups.push(input.onAction(handleAction));

  canvas.addEventListener("wheel", onWheel, { passive: true });
  function onWheel(e: WheelEvent) { camera.zoomBy(e.deltaY > 0 ? 1.12 : 0.9); }
  cleanups.push(() => canvas.removeEventListener("wheel", onWheel));

  const onClick = () => { if (!closePanel && !touch) input.lockPointer(); };
  canvas.addEventListener("click", onClick);
  cleanups.push(() => canvas.removeEventListener("click", onClick));

  // the loop
  /** Hands off the controls: what the pod is given while the answer is up. */
  const STILL: Intent = { thrust: 0, strafe: 0, rise: 0, yaw: 0, pitch: 0, boost: false };
  let elapsed = 0;
  let hudClock = 0;
  let where = { street: null as string | null, place: null as string | null };
  const step = (dt: number) => {
    elapsed += dt;
    // While the answer is up the camera is off the pod, so flying would be
    // flying blind: the controls go quiet until the next case is dealt.
    const revealing = reveal.frame !== null;
    const intent = input.read(dt);
    pod.step(dt, revealing ? STILL : intent, tiles.world, elapsed);
    if (pod.bumped) { bumpSound(); camera.kick(0.6); }
    tiles.update(dt, pod.position.x, pod.position.z, elapsed);
    beacons.update(elapsed, pod.position.x, pod.position.z);
    others.update(dt);
    witnessMarks.update(dt, elapsed, pod.position.x, pod.position.z);
    reveal.update(elapsed);
    camera.update(dt, pod.position, pod.quaternion, pod.speed01);

    // the history game: who is in earshot. The place itself is never given
    // away by flying over it — you have to say that this is the spot.
    nearWitness = witnessMarks.nearest(pod.position.x, pod.position.y, pod.position.z, WITNESS_WITHIN_M);

    const near = beacons.nearest(pod.position.x, pod.position.y, pod.position.z);
    if (near && near.id !== announced) { nearSound(); announced = near.id; }
    if (!near) announced = null;
    nearMemory = near;

    hudClock += dt;
    if (hudClock > 0.25) { hudClock = 0; where = whereAmI(); }
  };

  const render = (_alpha: number, frameDt: number) => {
    view.follow(pod.position.x, pod.position.y, pod.position.z, elapsed);
    setHum(pod.speed01, pod.boosting);
    hud.setPointerHint(!input.locked && !closePanel && !touch && !chat.isOpen);
    const answering = !!game.current && !game.current.solved;
    const showing = reveal.frame !== null;
    touch?.setLock(answering);
    hud.setLockKey(answering);
    if (!closePanel) {
      hud.prompt(showing
        // the controls are handed to the reveal until the next case is dealt
        ? `<kbd>G</kbd> the case file, and the next one`
        : nearWitness
        ? `<kbd>E</kbd> talk to <b>${escapeHtml(nearWitness.name)}</b>`
        : nearMemory
        ? `<kbd>E</kbd> read what <b>${escapeHtml(nearMemory.by || "someone")}</b> left here`
        : answering
        ? Date.now() < armedUntil
          ? `<kbd>L</kbd> again to lock in <b>${escapeHtml(where.place ?? where.street ?? "this spot")}</b> as your answer`
          : `<kbd>L</kbd> lock in this spot as your answer`
        : pod.speed01 < 0.08 ? `<kbd>M</kbd> leave a memory ${where.place ? `at ${escapeHtml(where.place)}` : where.street ? `on ${escapeHtml(where.street)}` : "here"}` : null);
    } else hud.prompt(null);

    const nearest = nearestMemory();
    hud.update(frameDt, {
      city: city.label,
      street: where.street,
      place: where.place,
      yaw: pod.yaw,
      alt: pod.position.y,
      speed: pod.velocity.length(),
      x: pod.position.x,
      z: pod.position.z,
      memories: beacons.positions(),
      others: others.positions(),
      witnesses: witnessMarks.positions(),
      answer: answerOnMap(),
      roads: tiles.world.segmentsNear(pod.position.x, pod.position.z, 430).map((s) => ({ x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2, major: MAJOR.has(s.kind) })),
      nearest,
    });
    view.render(camera.camera);
  };

  /**
   * Put the answer on the ground and hand the camera to it: a gold pole where
   * it really was, your post where you said it was, dashes between them.
   */
  const showAnswer = () => {
    const run = game.current;
    if (!run || !run.solved) return;
    reveal.show(
      { x: run.site.x, z: run.site.y, title: run.site.title },
      run.guess ? { x: run.guess.x, z: run.guess.y } : null,
    );
    camera.hold(reveal.frame);
  };

  /** Back to the pod, and clear the ground, when the next case is dealt. */
  const hideAnswer = () => {
    reveal.clear();
    camera.hold(null);
  };

  /**
   * The closed case, for the minimap: where it really was, and the spot you
   * called it from. Nothing until the answer has been given away.
   */
  const answerOnMap = () => {
    const run = game.current;
    // giving up shows the place too — that is what giving up buys you
    if (!run || !run.solved) return null;
    return { x: run.site.x, z: run.site.y, from: run.guess ? { x: run.guess.x, z: run.guess.y } : null };
  };

  /**
   * What the readout points at. While a case is running, the witness who will
   * actually talk to you matters more than the nearest memory.
   */
  const nearestMemory = () => {
    const bearingTo = (x: number, z: number) => {
      const dx = x - pod.position.x, dz = z - pod.position.z;
      return { dist: Math.hypot(dx, dz), bearing: Math.atan2(dx, -dz) };
    };

    const run = game.current;
    if (run && !run.solved) {
      let best: { dist: number; bearing: number; label: string } | null = null;
      for (const w of witnessMarks.positions()) {
        if (!w.unlocked || w.told) continue;
        const at = bearingTo(w.x, w.z);
        if (!best || at.dist < best.dist) best = { ...at, label: "witness" };
      }
      if (best) return best;
    }

    let best: { dist: number; bearing: number; label: string } | null = null;
    for (const m of beacons.positions()) {
      const at = bearingTo(m.x, m.z);
      if (!best || at.dist < best.dist) best = { ...at, label: "nearest memory" };
    }
    return best;
  };

  const onResize = () => camera.resize(view.aspect);
  window.addEventListener("resize", onResize);
  cleanups.push(() => window.removeEventListener("resize", onResize));

  const loop = new Loop(step, render);
  loop.start();
  hud.toast(`${city.label}. ${tiles.counts.buildings.toLocaleString()} buildings raised. ${touch ? "Drag to look, stick to move." : "Click to take the controls."}`, false, 5000);
  if (arrival) hud.toast(`${arrival.by || "Someone"}'s memory is the lantern ahead of you.`, false, 6000);
  // The history game is the least discoverable thing here, so say so once.
  else setTimeout(() => hud.toast("Press G to be given a piece of this city's history to find.", false, 7000), 6000);

  const endSession = () => {
    loop.stop();
    input.unlockPointer();
    for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* ignore */ } }
    if (closePanel) { closePanel(); closePanel = null; }
    hud.root.remove();
    touch?.remove();
    chat.remove();
    witnessMarks.clear();
    reveal.clear();
    view.renderer.dispose();
    view.scene.clear();
    setHum(0, false);
    session = null;
    history.replaceState(null, "", location.pathname);
    void showBoot();
  };

  session = { city, choice, stop: endSession };
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

// ---- go ----------------------------------------------------------------------------------

if (!firebaseReady) console.info("nukkad: Firebase is not configured; memories stay in this browser.");
void showBoot();
export { session };
