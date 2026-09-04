// The three.js scene: renderer, light, sky, fog, ground and the drifting motes
// that make the air feel like something you move through.

import * as THREE from "three";
import { LAND } from "../world/build";

export type Atmosphere = {
  sky: number;
  horizon: number;
  fog: number;
  sun: number;
  sunIntensity: number;
  ambient: number;
  ambientIntensity: number;
  fogNear: number;
  fogFar: number;
};

/** A late, clear afternoon. */
export const AFTERNOON: Atmosphere = {
  sky: 0x7fb4e6, horizon: 0xd9e6f0, fog: 0xc9d8e6, sun: 0xfff1d6, sunIntensity: 2.2,
  ambient: 0xcfdcee, ambientIntensity: 1.9, fogNear: 250, fogFar: 1700,
};
/** Dusk: warmer, hazier, lanterns glow. */
export const DUSK: Atmosphere = {
  sky: 0x2b3a5c, horizon: 0xf0a06a, fog: 0x8b7f95, sun: 0xffb070, sunIntensity: 1.6,
  ambient: 0x8090b8, ambientIntensity: 0.9, fogNear: 180, fogFar: 1400,
};

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly ambient: THREE.HemisphereLight;
  readonly ground: THREE.Mesh;
  private motes: THREE.Points;
  private moteBase: Float32Array;
  private skyMesh: THREE.Mesh;
  private skyUniforms: { top: { value: THREE.Color }; bottom: { value: THREE.Color } };
  private shadowsOn: boolean;

  constructor(canvas: HTMLCanvasElement, atmosphere: Atmosphere = AFTERNOON) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.shadowsOn = !/Mobi|Android/i.test(navigator.userAgent);
    this.renderer.shadowMap.enabled = this.shadowsOn;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.fog = new THREE.Fog(atmosphere.fog, atmosphere.fogNear, atmosphere.fogFar);

    this.sun = new THREE.DirectionalLight(atmosphere.sun, atmosphere.sunIntensity);
    this.sun.position.set(260, 460, 300);
    this.sun.castShadow = this.shadowsOn;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 50;
    this.sun.shadow.camera.far = 1400;
    this.sun.shadow.camera.left = -260;
    this.sun.shadow.camera.right = 260;
    this.sun.shadow.camera.top = 260;
    this.sun.shadow.camera.bottom = -260;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);

    this.ambient = new THREE.HemisphereLight(atmosphere.ambient, 0x9a9384, atmosphere.ambientIntensity);
    this.scene.add(this.ambient);

    // the ground: a big plane that follows the player
    const groundTexture = noiseTexture();
    const groundMaterial = new THREE.MeshLambertMaterial({ color: LAND, map: groundTexture });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // sky: a gradient dome drawn behind everything
    this.skyUniforms = { top: { value: new THREE.Color(atmosphere.sky) }, bottom: { value: new THREE.Color(atmosphere.horizon) } };
    this.skyMesh = new THREE.Mesh(
      new THREE.SphereGeometry(5000, 24, 12),
      new THREE.ShaderMaterial({
        uniforms: this.skyUniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        vertexShader: `varying vec3 vPos; void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vPos;
          void main(){ float h = clamp(vPos.y / 2200.0, 0.0, 1.0); h = pow(h, 0.55);
          gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
      }),
    );
    this.scene.add(this.skyMesh);

    // motes: small drifting points around the player
    const count = 900;
    this.moteBase = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.moteBase[i * 3] = (Math.random() - 0.5) * 240;
      this.moteBase[i * 3 + 1] = Math.random() * 120;
      this.moteBase[i * 3 + 2] = (Math.random() - 0.5) * 240;
    }
    const moteGeometry = new THREE.BufferGeometry();
    moteGeometry.setAttribute("position", new THREE.BufferAttribute(this.moteBase.slice(), 3));
    this.motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({
      color: 0xffffff, size: 0.35, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true,
    }));
    this.scene.add(this.motes);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setAtmosphere(a: Atmosphere) {
    (this.scene.fog as THREE.Fog).color.setHex(a.fog);
    (this.scene.fog as THREE.Fog).near = a.fogNear;
    (this.scene.fog as THREE.Fog).far = a.fogFar;
    this.sun.color.setHex(a.sun);
    this.sun.intensity = a.sunIntensity;
    this.ambient.color.setHex(a.ambient);
    this.ambient.intensity = a.ambientIntensity;
    this.skyUniforms.top.value.setHex(a.sky);
    this.skyUniforms.bottom.value.setHex(a.horizon);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
  }

  get aspect() { return window.innerWidth / Math.max(1, window.innerHeight); }

  /** Keep the ground, sky, shadow frustum and motes centred on the player. */
  follow(x: number, y: number, z: number, elapsed: number) {
    this.ground.position.set(Math.round(x / 200) * 200, 0, Math.round(z / 200) * 200);
    this.skyMesh.position.set(x, 0, z);
    this.sun.position.set(x + 260, 460, z + 300);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();

    const positions = this.motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = positions.array as Float32Array;
    const base = this.moteBase;
    const cx = Math.round(x / 40) * 40, cz = Math.round(z / 40) * 40;
    for (let i = 0; i < arr.length; i += 3) {
      const t = elapsed * 0.15 + i;
      arr[i] = cx + base[i] + Math.sin(t * 0.7) * 1.5;
      arr[i + 1] = Math.max(1, y - 40 + base[i + 1] + Math.sin(t * 0.4) * 2);
      arr[i + 2] = cz + base[i + 2] + Math.cos(t * 0.5) * 1.5;
    }
    positions.needsUpdate = true;
  }

  render(camera: THREE.Camera) {
    this.renderer.render(this.scene, camera);
  }
}

/** A faint speckle so a flat plane reads as ground and speed is visible. */
const noiseTexture = () => {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const v = 225 + Math.floor(Math.random() * 30);
    g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(140, 140);
  texture.anisotropy = 4;
  return texture;
};
