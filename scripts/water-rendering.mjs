/**
 * Optional per-Region water surface ripple PNGs.
 *
 * There is NO default ring, Graphics ellipse, or procedural geometry.
 * A GM-selected transparent PNG follows a token that actually intersects
 * the Region's water surface. The sprite is non-interactive and local to
 * each client; no world-document writes or persistent Canvas geometry.
 */
import { MODULE_ID, finite } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getWaterRegionData, tokenCenter } from "./water-regions.mjs";

const sprites = new Map();
const pending = new Map();
const failedSources = new Set();
let layer = null;
let ticker = null;

function isAllowed(token) {
  const doc = token?.document;
  return Boolean(doc && token.visible !== false &&
    (!doc.hidden || Boolean(game.user?.isGM)));
}

export function getTokenSurfaceRingPng(token) {
  if (!isAllowed(token)) return "";
  const state = getTokenWaterState(token.document);
  if (!state.inWater || !state.intersectsSurface || !state.region) return "";
  const path = getWaterRegionData(state.region).ringPng;
  return typeof path === "string" && /\.png(?:[?#].*)?$/i.test(path)
    ? path : "";
}

function ensureLayer() {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || !canvas.interface || !globalThis.PIXI?.Container) return null;
  if (layer?.parent === canvas.interface && !layer.destroyed) return layer;
  clearLayer();
  layer = new PIXI.Container();
  layer.name = MODULE_ID + "-custom-surface-ripples";
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  canvas.interface.addChild(layer);
  return layer;
}

function stopTicker() {
  if (ticker?.remove) ticker.remove(followTokenRings);
  ticker = null;
}
function clearLayer() {
  for (const token of [...sprites.keys()]) removeRing(token);
  if (layer) layer.destroy({children:false});
  layer = null;
  pending.clear();
}
function removeRing(token) {
  const old = sprites.get(token);
  if (!old) return false;
  sprites.delete(token);
  old.sprite.destroy({children:false,texture:false,baseTexture:false});
  return true;
}
function syncPosition(token, sprite) {
  const center = token?.center ?? tokenCenter(token?.document);
  if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y)) return;
  sprite.position.set(center.x, center.y);
  const gridSize = finite(token?.document?.parent?.grid?.size, 100);
  const nativeW = finite(token?.w, finite(token?.document?.width,1)*gridSize);
  const nativeH = finite(token?.h, finite(token?.document?.height,1)*gridSize);
  // Elliptic transparent artwork supplied by the GM, not drawn by us.
  sprite.width = Math.max(4, nativeW*1.25);
  sprite.height = Math.max(4, nativeH*0.48);
  sprite.alpha = Math.max(0, Math.min(1, finite(token?.document?.alpha,1)));
  sprite.visible = isAllowed(token);
}

function followTokenRings() {
  if (!globalThis.canvas?.ready) return;
  for (const [token, entry] of sprites) {
    const desired = getTokenSurfaceRingPng(token);
    if (!desired || desired !== entry.src) {
      removeRing(token);
      continue;
    }
    syncPosition(token, entry.sprite);
  }
  if (!sprites.size) stopTicker();
}
function startTicker() {
  const next = globalThis.canvas?.app?.ticker;
  if (!next?.add || ticker === next) return;
  stopTicker();
  next.add(followTokenRings);
  ticker = next;
}
async function loadRingTexture(src) {
  const load = globalThis.foundry?.canvas?.loadTexture ??
    globalThis.loadTexture;
  if (typeof load !== "function") return null;
  try {
    // loadTexture is Foundry v13's documented cached async texture loader.
    return await load(src);
  } catch (error) {
    if (!failedSources.has(src)) {
      console.warn(MODULE_ID + " | PNG de surface introuvable : " + src, error);
      failedSources.add(src);
    }
    return null;
  }
}

async function refreshRingForToken(token) {
  if (!token?.document || !globalThis.canvas?.ready) return false;
  const src = getTokenSurfaceRingPng(token);
  const current = sprites.get(token);
  if (!src) {
    pending.delete(token);
    return removeRing(token);
  }
  if (current?.src === src) {
    syncPosition(token,current.sprite);
    return false;
  }
  if (current) removeRing(token);
  const existing = pending.get(token);
  if (existing?.src === src) return existing.task;

  const task = (async () => {
    const texture = await loadRingTexture(src);
    // File changed, movement completed, or scene replaced during load.
    if (!texture || pending.get(token)?.src !== src ||
        !globalThis.canvas?.ready ||
        token.document?.parent?.id !== globalThis.canvas.scene?.id ||
        getTokenSurfaceRingPng(token) !== src) return false;
    const parent = ensureLayer();
    if (!parent || !globalThis.PIXI?.Sprite) return false;
    const sprite = new PIXI.Sprite(texture);
    sprite.name = MODULE_ID + "-ripple-" + (token.document?.id ?? "token");
    sprite.eventMode = "none";
    sprite.interactive = false;
    sprite.anchor?.set?.(0.5);
    parent.addChild(sprite);
    sprites.set(token,{sprite,src});
    syncPosition(token,sprite);
    startTicker();
    return true;
  })().finally(() => {
    if (pending.get(token)?.task === task) pending.delete(token);
  });
  pending.set(token,{src,task});
  return task;
}

/** Public compatibility API: now renders optional PNGs, never blue ellipses. */
export async function refreshWaterSurfaceMarkers() {
  if (!globalThis.canvas?.ready) return 0;
  const tokens = globalThis.canvas.tokens?.placeables ?? [];
  const active = new Set(tokens);
  for (const token of [...sprites.keys()]) {
    if (!active.has(token)) removeRing(token);
  }
  let updated = 0;
  for (const token of tokens) {
    if (await refreshRingForToken(token)) updated++;
  }
  return updated;
}

export function registerWaterRenderingHooks() {
  for (const event of [
    "canvasReady","createToken","updateToken","deleteToken",
    "refreshToken","drawToken","createRegion","updateRegion","deleteRegion"
  ]) {
    Hooks.on(event, () => { void refreshWaterSurfaceMarkers(); });
  }
  Hooks.on("canvasTearDown", () => {
    stopTicker();
    clearLayer();
  });
}
