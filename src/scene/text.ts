// Text drawn onto canvases and shown as sprites: street names, place names,
// the names above other people's pods.

import * as THREE from "three";

type Style = {
  size?: number;
  colour?: string;
  background?: string;
  border?: string;
  icon?: string;
  weight?: string;
  font?: string;
};

const cache = new Map<string, { texture: THREE.CanvasTexture; aspect: number }>();

const key = (text: string, style: Style) => JSON.stringify([text, style]);

/** A texture with the text on it, shared by everything that shows the same label. */
export const textTexture = (text: string, style: Style = {}) => {
  const k = key(text, style);
  const hit = cache.get(k);
  if (hit) return hit;

  const size = style.size ?? 40;
  const font = `${style.weight ?? "600"} ${size}px ${style.font ?? "'Inter', 'Helvetica Neue', system-ui, sans-serif"}`;
  const pad = size * 0.5;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const label = style.icon ? `${style.icon}  ${text}` : text;
  const width = Math.ceil(measure.measureText(label).width + pad * 2);
  const height = Math.ceil(size * 1.6);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  if (style.background) {
    g.fillStyle = style.background;
    const r = height / 2;
    g.beginPath();
    g.roundRect(0, 0, width, height, r);
    g.fill();
    if (style.border) {
      g.strokeStyle = style.border;
      g.lineWidth = 3;
      g.stroke();
    }
  }
  g.font = font;
  g.textBaseline = "middle";
  g.textAlign = "center";
  if (!style.background) {
    g.lineWidth = size * 0.18;
    g.strokeStyle = "rgba(8, 12, 20, 0.85)";
    g.lineJoin = "round";
    g.strokeText(label, width / 2, height / 2 + 1);
  }
  g.fillStyle = style.colour ?? "#ffffff";
  g.fillText(label, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const entry = { texture, aspect: width / height };
  cache.set(k, entry);
  return entry;
};

/** A sprite showing the label, `height` metres tall in the world. */
export const textSprite = (text: string, height: number, style: Style = {}) => {
  const { texture, aspect } = textTexture(text, style);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(height * aspect, height, 1);
  sprite.renderOrder = 10;
  return sprite;
};

/** A soft glowing disc, for lanterns and pods. */
let glowTexture: THREE.CanvasTexture | null = null;
export const haloTexture = () => {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
};
