// Renders a small picture of each product with the game's own item mesh + label, so the
// shopping list and the overhead markers show exactly what to look for on the shelves.
import * as THREE from 'three';
import { KIND_BY_ID } from './config';
import { itemGeometry, itemMaterial } from './items';

const SIZE = 128;
const urls = new Map<string, string>();
const canvases = new Map<string, HTMLCanvasElement>();
let scene: THREE.Scene | null = null;
let cam: THREE.PerspectiveCamera;
let rt: THREE.WebGLRenderTarget;

function setup() {
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 2.2));
  const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 4, 5); scene.add(d);
  cam = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  rt = new THREE.WebGLRenderTarget(SIZE, SIZE, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
}

/** Canvas with the product rendered on a transparent background (cached per kind). */
export function thumbCanvas(renderer: THREE.WebGLRenderer, kindId: string): HTMLCanvasElement {
  const hit = canvases.get(kindId);
  if (hit) return hit;
  if (!scene) setup();
  const k = KIND_BY_ID[kindId];
  const mesh = new THREE.InstancedMesh(itemGeometry(k, true), itemMaterial(k), 1);
  mesh.setMatrixAt(0, new THREE.Matrix4());
  mesh.setColorAt(0, new THREE.Color(k.colors[0]));
  // three-quarter view of the labelled front face
  mesh.rotation.y = -0.45;
  mesh.rotation.x = k.shape === 'sphere' ? 0 : 0.12;
  scene!.add(mesh);
  const r = Math.hypot(...k.size) / 2;
  const dist = r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.08;
  cam.position.set(0, r * 0.25, dist); cam.lookAt(0, 0, 0);
  const prevRt = renderer.getRenderTarget(), prevClear = renderer.getClearAlpha(), prevColor = renderer.getClearColor(new THREE.Color());
  const prevTone = renderer.toneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene!, cam);
  const buf = new Uint8Array(SIZE * SIZE * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, SIZE, SIZE, buf);
  renderer.setRenderTarget(prevRt);
  renderer.setClearColor(prevColor, prevClear);
  renderer.toneMapping = prevTone;
  scene!.remove(mesh);
  mesh.geometry.dispose();
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d')!;
  const img = g.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) img.data.set(buf.subarray((SIZE - 1 - y) * SIZE * 4, (SIZE - y) * SIZE * 4), y * SIZE * 4); // flip Y
  g.putImageData(img, 0, 0);
  canvases.set(kindId, c);
  return c;
}

export function thumbUrl(renderer: THREE.WebGLRenderer, kindId: string): string {
  let u = urls.get(kindId);
  if (!u) { u = thumbCanvas(renderer, kindId).toDataURL(); urls.set(kindId, u); }
  return u;
}
