// nukhadv2: fly a real city, find the memories people left where they
// happened, leave your own.
//
// This file wires the pieces together. Each piece knows nothing about the
// others: the tile streamer draws, the pod flies, the beacons glow, the UI
// asks and tells. Everything meets here.

import "./ui/styles.css";
import * as THREE from "three";
import { citySlug, toLatLon, toMetres, WORLD_LIMIT_M, type CityData } from "@shared/geo";
import { Input, type Action } from "./engine/input";
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
import { TileStreamer } from "./world/tiles";
import { Pod } from "./player/pod";
import { FollowCamera } from "./player/camera";
import { Boot, type BootChoice } from "./ui/boot";
import { Hud } from "./ui/hud";
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
          onLeaveCity: () => endSession(),
          onClose: dismiss,
        }));
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
  let elapsed = 0;
  let hudClock = 0;
  let where = { street: null as string | null, place: null as string | null };
  const step = (dt: number) => {
    elapsed += dt;
    const intent = input.read(dt);
    pod.step(dt, intent, tiles.world, elapsed);
    if (pod.bumped) { bumpSound(); camera.kick(0.6); }
    tiles.update(dt, pod.position.x, pod.position.z, elapsed);
    beacons.update(elapsed, pod.position.x, pod.position.z);
    others.update(dt);
    camera.update(dt, pod.position, pod.quaternion, pod.speed01);

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
    if (!closePanel) {
      hud.prompt(nearMemory
        ? `<kbd>E</kbd> read what <b>${escapeHtml(nearMemory.by || "someone")}</b> left here`
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
      roads: tiles.world.segmentsNear(pod.position.x, pod.position.z, 430).map((s) => ({ x1: s.x1, z1: s.z1, x2: s.x2, z2: s.z2, major: MAJOR.has(s.kind) })),
      nearest,
    });
    view.render(camera.camera);
  };

  const nearestMemory = () => {
    let best: { dist: number; bearing: number } | null = null;
    for (const m of beacons.positions()) {
      const dx = m.x - pod.position.x, dz = m.z - pod.position.z;
      const d = Math.hypot(dx, dz);
      if (!best || d < best.dist) best = { dist: d, bearing: Math.atan2(dx, -dz) };
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

  const endSession = () => {
    loop.stop();
    input.unlockPointer();
    for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* ignore */ } }
    if (closePanel) { closePanel(); closePanel = null; }
    hud.root.remove();
    touch?.remove();
    chat.remove();
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

if (!firebaseReady) console.info("nukhad: Firebase is not configured; memories stay in this browser.");
void showBoot();
export { session };
