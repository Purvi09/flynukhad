// The Blender models, loaded once and cloned.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const loader = new GLTFLoader();
const loaded = new Map<string, Promise<THREE.Group>>();

const load = (name: string) => {
  let pending = loaded.get(name);
  if (!pending) {
    pending = new Promise<THREE.Group>((resolve, reject) => {
      loader.load(`/models/${name}.glb`, (gltf) => {
        gltf.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            const mesh = o as THREE.Mesh;
            mesh.castShadow = true;
            mesh.receiveShadow = false;
          }
        });
        resolve(gltf.scene);
      }, undefined, reject);
    });
    loaded.set(name, pending);
  }
  return pending;
};

export const loadPod = () => load("pod");
export const loadTree = () => load("tree");
export const loadLantern = () => load("lantern");

/**
 * Every mesh inside a model. A Blender object with two materials arrives as
 * two meshes under one group, one per material.
 */
export const allMeshes = (group: THREE.Group): THREE.Mesh[] => {
  const found: THREE.Mesh[] = [];
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) found.push(o as THREE.Mesh); });
  return found;
};

/**
 * A copy of the pod with its hull painted. Materials are shared by default,
 * so the hull material is cloned per pod and the rest stay shared.
 */
export const paintedPod = (source: THREE.Group, colour: number) => {
  const clone = source.clone(true);
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const painted = materials.map((m) => {
      if (m.name === "Hull") {
        const copy = (m as THREE.MeshStandardMaterial).clone();
        copy.color.setHex(colour);
        return copy;
      }
      if (m.name === "Glass") {
        const glass = m as THREE.MeshStandardMaterial;
        glass.transparent = true;
        glass.opacity = 0.55;
        glass.depthWrite = false;
      }
      if (m.name === "Light") {
        const light = m as THREE.MeshStandardMaterial;
        light.emissiveIntensity = 2.5;
      }
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? painted : painted[0];
  });
  return clone;
};

/** Reusable: the lantern with its glow emitting properly under our lighting. */
export const preparedLantern = (source: THREE.Group) => {
  const clone = source.clone(true);
  clone.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const std = m as THREE.MeshStandardMaterial;
      if (m.name === "Glow") { std.emissiveIntensity = 3; std.toneMapped = false; }
      if (m.name === "Paper") { std.transparent = true; std.opacity = 0.9; std.emissive = new THREE.Color(0xffb060); std.emissiveIntensity = 0.35; }
    }
    mesh.castShadow = false;
  });
  return clone;
};
