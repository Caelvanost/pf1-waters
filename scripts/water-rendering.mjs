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
  // Rings render below emerged token replicas in the interface group.
  // A centre cutout protects native token portraits in the Primary group.
  layer.zIndex = -10000;
  if (typeof canvas.interface.addChildAt === "function") {
    canvas.interface.addChildAt(layer, 0);
  } else canvas.interface.addChild(layer);
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
  old.sprite.mask = null;
  old.sprite.destroy({children:false,texture:false,baseTexture:false});
  old.mask?.destroy?.({children:false});
  return true;
}
/**
 * Token-centred ripple dimensions, controlled by its water Region.
 * Default ratio is 1.5: 1×1→1.5×1.5, 2×2→3×3, 2×1→3×1.5.
 * The Region's CURRENT value is read during every Canvas refresh/tick,
 * so changing the ratio does not require reloading token textures.
 */
export function getWaterRingFootprint(token) {
  const doc = token?.document ?? token;
  const state = getTokenWaterState(doc);
  const region = state?.region;
  const configured = region ? getWaterRegionData(region).ringScale : 1.5;
  const ratio = Number.isFinite(configured) && configured > 0 ? configured : 1.5;
  const square = Math.max(1, finite(doc?.parent?.grid?.size, 100));
  const width = Math.max(0, finite(doc?.width, 1)) * square;
  const height = Math.max(0, finite(doc?.height, 1)) * square;
  return {
    width: width * ratio,
    height: height * ratio,
    tokenWidth: width,
    tokenHeight: height,
    square,
    ratio
  };
}

/**
 * Visually keeps the ripple BELOW the token portrait. The interface
 * group draws after native tokens, so its invisible stencil hides the
 * central portrait area. The emitted foreground-token replica is also
 * drawn above the ripple layer. No graphic ellipse is generated.
 */
function updateRingMask(entry, footprint) {
  const mask = entry.mask;
  if (!mask?.clear) return;
  const {width:w,height:h,tokenWidth:tw,tokenHeight:th} = footprint;
  const signature = [w,h,tw,th].join(":");
  if (entry.maskSize === signature) return;
  entry.maskSize = signature;
  mask.clear();
  const rects = [
    [-w/2,-h/2,w,(h-th)/2],
    [-w/2,th/2,w,(h-th)/2],
    [-w/2,-th/2,(w-tw)/2,th],
    [tw/2,-th/2,(w-tw)/2,th]
  ].filter((r)=>r[2]>0&&r[3]>0);
  // PIXI v8 (Foundry v13), with legacy Graphics fallback.
  if (typeof mask.rect === "function" && typeof mask.fill === "function") {
    for (const [x,y,width,height] of rects) {
      mask.rect(x,y,width,height).fill({color:0xffffff});
    }
  } else if (typeof mask.beginFill === "function" &&
             typeof mask.drawRect === "function") {
    mask.beginFill(0xffffff);
    for(const r of rects) mask.drawRect(...r);
    mask.endFill?.();
  }
}
function syncPosition(token, entry) {
  const center = token?.center ?? tokenCenter(token?.document);
  if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y)) return;
  const {sprite, mask} = entry;
  const size = getWaterRingFootprint(token);
  sprite.position.set(center.x,center.y);
  sprite.width = size.width;
  sprite.height = size.height;
  if (mask) {
    mask.position.set(center.x,center.y);
    updateRingMask(entry,size);
  }
  sprite.alpha = Math.max(0,Math.min(1,finite(token?.document?.alpha,1)));
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
    syncPosition(token, entry);
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
    syncPosition(token,current);
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
    const mask = typeof globalThis.PIXI?.Graphics === "function"
      ? new PIXI.Graphics() : null;
    if (mask) {
      mask.name = sprite.name + "-stencil";
      mask.eventMode = "none";
      parent.addChild(mask);
      sprite.mask = mask;
    }
    parent.addChild(sprite);
    const entry = {sprite,src,mask,maskSize:null};
    sprites.set(token,entry);
    syncPosition(token,entry);
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
