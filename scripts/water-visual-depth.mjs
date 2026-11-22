/**
 * PF1 Waters — visual compositing around linked water surfaces (Foundry v13).
 *
 * A partially emerged token gets a non-interactive replica in the interface
 * canvas group. It is ABOVE the linked Tile/Drawing even when a roof/Levels
 * module defeats primary-mesh elevation sorting. No TokenDocument is mutated.
 *
 * A fully submerged token remains in its native PrimaryCanvasGroup (BEHIND
 * translucent surface artwork). Its image fades in the final part of a
 * per-surface visibility-depth interval, and disappears at the limit.
 *
 * The overlay must never bypass token visibility/permissions. Gameplay
 * immersion, PF1AE cover and movement are untouched.
 */
import { MODULE_ID, EPSILON, finite } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getWaterSurfaceData, getWaterSurfacesForRegion } from "./water-surface-links.mjs";
import { tokenCenter, getWaterRegionData } from "./water-regions.mjs";

const overlaySprites = new Map();
const alphaOverrides = new WeakMap();
const nativeVisibilityOverrides = new WeakMap();
const warnings = new Set();
let layer = null;
let ticker = null;
let refreshing = false;

function warnOnce(message, error) {
  if (warnings.has(message)) return;
  warnings.add(message);
  console.warn(MODULE_ID + " | " + message, error ?? "");
}
function rectContains(doc, point) {
  const x = finite(doc?.x, NaN), y = finite(doc?.y, NaN);
  const w = Number(doc?.width ?? doc?.shape?.width);
  const h = Number(doc?.height ?? doc?.shape?.height);
  if (![x, y, w, h].every(Number.isFinite) || w === 0 || h === 0) return false;
  const cx = x + w / 2, cy = y + h / 2;
  const angle = -finite(doc?.rotation, 0) * Math.PI / 180;
  const dx = point.x - cx, dy = point.y - cy;
  const lx = Math.cos(angle) * dx - Math.sin(angle) * dy;
  const ly = Math.sin(angle) * dx + Math.cos(angle) * dy;
  return Math.abs(lx) <= Math.abs(w) / 2 && Math.abs(ly) <= Math.abs(h) / 2;
}

/** The linked image's actual 2D footprint is required. */
export function surfaceContainsTokenCenter(surface, token) {
  const doc = surface?.document ?? surface;
  const tokenDoc = token?.document ?? token;
  if (!doc?.parent || doc.parent.id !== tokenDoc?.parent?.id) return false;
  const point = tokenCenter(tokenDoc);
  const primary = doc.object?.mesh ?? doc.object?.shape;
  if (typeof primary?.containsCanvasPoint === "function") {
    try { return Boolean(primary.containsCanvasPoint(point)); }
    catch (error) { warnOnce("Test visuel de surface indisponible", error); }
  }
  const bounds = doc.object?.bounds;
  if (typeof bounds?.contains === "function" && finite(doc.rotation, 0) === 0) {
    return Boolean(bounds.contains(point.x, point.y));
  }
  return rectContains(doc, point);
}

/** Legacy public diagnostic: sorting elevation needed in the primary group. */
export function calculateWaterVisualElevation(state, visualElevations = []) {
  if (!state?.inWater || !state.intersectsSurface || state.flying) return null;
  if (!(state.tokenBottom < state.surface - EPSILON &&
        state.tokenTop > state.surface + EPSILON)) return null;
  const elevations = visualElevations.map(Number).filter(Number.isFinite);
  return elevations.length
    ? Math.max(state.surface, ...elevations) + 0.001 : null;
}

export function getTokenWaterVisualElevation(token) {
  const doc = token?.document ?? token;
  const state = getTokenWaterState(doc);
  if (!state.region || !state.intersectsSurface) return null;
  const surfaces = getWaterSurfacesForRegion(state.region).filter((surface) =>
    surfaceContainsTokenCenter(surface, doc)
  );
  return calculateWaterVisualElevation(state, surfaces.map((surface) =>
    finite(surface.elevation, state.surface)
  ));
}

/**
 * Fully submerged visibility: top-of-token depth (NOT base depth) from the
 * actual water surface. The first 70% of the range remains fully visible;
 * the final 30% fades smoothly, reaching 0 at maximum depth.
 */
export function calculateUnderwaterVisualOpacity(topDepth, maxDepth) {
  if (!Number.isFinite(topDepth) || !Number.isFinite(maxDepth)) return 1;
  if (topDepth < -EPSILON) return 1;
  if (maxDepth <= 0) return 0;
  const depth = Math.max(0, topDepth);
  const start = maxDepth * 0.7;
  if (depth <= start + EPSILON) return 1;
  return Math.max(0, Math.min(1, (maxDepth - depth) / (maxDepth - start)));
}

/**
 * "emerged": renderer-independent overlay above linked water art.
 * "submerged": native token stays under the transparent art, with local fade.
 */
export function getTokenWaterVisualDisplay(token) {
  const doc = token?.document ?? token;
  const state = getTokenWaterState(doc);
  if (!state.region || !state.inWater) return null;
  const surfaces = getWaterSurfacesForRegion(state.region).filter((surface) =>
    surfaceContainsTokenCenter(surface, doc)
  );
  if (!surfaces.length) return null;
  if (state.intersectsSurface && state.tokenTop > state.surface + EPSILON) {
    return { mode: "emerged", opacity: 1, depth: 0, maximumDepth: 0 };
  }
  if (!state.fullySubmerged) return null;
  // If two surface images cover this position, use the more permissive depth.
  // A configured Region limit is authoritative for every linked surface.
  // Older worlds without this field retain their per-Tile/Drawing settings.
  const regionLimit = getWaterRegionData(state.region).visibilityDepth;
  const maximumDepth = Number.isFinite(regionLimit) ? regionLimit :
    Math.max(...surfaces.map((surface) =>
      getWaterSurfaceData(surface).visibilityDepth
    ));
  const depth = Math.max(0, state.surface - state.tokenTop);
  return {
    mode: "submerged",
    opacity: calculateUnderwaterVisualOpacity(depth, maximumDepth),
    depth, maximumDepth
  };
}

/**
 * A user viewing from the ship's deck has a vision source above the water,
 * even if the visible target TokenDocument's *base* is underwater.
 * Read current local vision sources: only sources belonging to this client's
 * active visibility context are considered (not arbitrary scene tokens).
 */
export function hasExteriorWaterViewer(surface, targetToken = null) {
  const canvas = globalThis.canvas;
  if (!Number.isFinite(surface) || !canvas) return false;
  if (game.user?.isGM && !(canvas.tokens?.controlled?.length)) return true;
  const observers = new Set(canvas.tokens?.controlled ?? []);
  const collection = canvas.effects?.visionSources ?? canvas.visibility?.visionSources;
  const sources = collection?.values?.() ?? (Array.isArray(collection) ? collection : []);
  for (const source of sources) {
    if (source?.active === false) continue;
    const object = source?.object ?? source?.token ?? source?.data?.object;
    if (object?.document) observers.add(object);
  }
  for (const source of observers) {
    if (!source?.document || source.document.parent?.id !== canvas.scene?.id) continue;
    // Native sight-height wins; on plain Foundry v13 use body top.
    const sourceEye = Number.isFinite(source.losHeight) ? source.losHeight :
      finite(source.document.elevation, 0) +
      Math.max(0, finite(source.document.height, 1)) *
      finite(canvas.scene?.grid?.distance, 0);
    if (sourceEye >= surface - EPSILON) return true;
  }
  return false;
}

/**
 * Only extend native Token visibility if an exterior source can actually
 * see the waterline through Foundry's own LOS/detection test.
 * Never bypass hidden tokens, token vision, walls, or detection modes.
 */
export function canSeeWaterTokenFromExterior(token, state = undefined) {
  const placeable = token?.mesh ? token : (token?.document ?? token)?.object;
  const doc = placeable?.document;
  const water = state ?? (doc ? getTokenWaterState(doc) : null);
  if (!doc || !water?.inWater || !Number.isFinite(water.surface) ||
      (doc.hidden && !game.user?.isGM) ||
      !hasExteriorWaterViewer(water.surface, placeable)) return false;
  const visibility = globalThis.canvas?.visibility;
  if (typeof visibility?.testVisibility !== "function") return false;
  const center = tokenCenter(doc);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return false;
  // From outside, test a point immediately on/above the transparent water.
  // The actual submerged limit is still checked separately.
  const sample = {
    x: center.x, y: center.y,
    elevation: Math.max(water.surface + EPSILON * 2,
      finite(water.tokenTop, water.surface))
  };
  try {
    return visibility.testVisibility(sample, {object: placeable}) === true;
  } catch (error) {
    warnOnce("Test de visibilité aquatique impossible", error);
    return false;
  }
}

/**
 * Foundry's standard Token.isVisible remains the authoritative baseline.
 * For a proven exterior LOS, allow its native primary mesh to render below
 * transparent water as usual. Reset when water/vision conditions cease.
 */
function syncWaterTokenVisibility(placeable, canShow) {
  if (!placeable?.document) return false;
  const existing = nativeVisibilityOverrides.get(placeable);
  const native = typeof placeable.isVisible === "boolean"
    ? placeable.isVisible : (existing?.nativeVisible ?? placeable.visible !== false);
  if (canShow && !native) {
    if (!existing) nativeVisibilityOverrides.set(placeable, {
      nativeVisible: placeable.visible !== false,
      meshVisible: placeable.mesh?.visible !== false
    });
    const changed = placeable.visible !== true ||
      (placeable.mesh && placeable.mesh.visible !== true);
    placeable.visible = true;
    if (placeable.mesh) placeable.mesh.visible = true;
    return Boolean(changed);
  }
  if (existing) {
    nativeVisibilityOverrides.delete(placeable);
    const desired = typeof placeable.isVisible === "boolean"
      ? native : existing.nativeVisible;
    const changed = placeable.visible !== desired;
    placeable.visible = desired;
    if (placeable.mesh) placeable.mesh.visible = desired && existing.meshVisible;
    return changed;
  }
  return false;
}

function ensureOverlayLayer() {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || !canvas.interface ||
      !globalThis.PIXI?.Container || !globalThis.PIXI?.Sprite) return null;
  if (layer?.parent === canvas.interface && !layer.destroyed) return layer;
  clearOverlays();
  layer = new PIXI.Container();
  layer.name = MODULE_ID + "-emerged-token-overlays";
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  canvas.interface.addChild(layer);
  return layer;
}

function removeOverlay(token) {
  const sprite = overlaySprites.get(token);
  if (!sprite) return false;
  overlaySprites.delete(token);
  // Texture belongs to Foundry's TokenMesh; never destroy shared textures.
  sprite.destroy({ children: false, texture: false, baseTexture: false });
  return true;
}

function clearOverlays() {
  for (const token of [...overlaySprites.keys()]) removeOverlay(token);
  if (layer) {
    layer.destroy({ children: false });
    layer = null;
  }
}

function copyPoint(to, from, fallbackX = 0, fallbackY = 0) {
  if (!to || typeof to.set !== "function") return;
  to.set(finite(from?.x, fallbackX), finite(from?.y, fallbackY));
}

/** Keep the visual copy synchronized with the native sprite, without input. */
function syncOverlaySprite(token, sprite) {
  const mesh = token?.mesh;
  const doc = token?.document;
  if (!mesh?.texture || !doc || sprite?.destroyed) return;
  if (sprite.texture !== mesh.texture) sprite.texture = mesh.texture;
  copyPoint(sprite.anchor, mesh.anchor, 0.5, 0.5);
  copyPoint(sprite.position, mesh.position, finite(doc.x), finite(doc.y));
  copyPoint(sprite.scale, mesh.scale, 1, 1);
  copyPoint(sprite.pivot, mesh.pivot, 0, 0);
  if (Number.isFinite(mesh.rotation)) sprite.rotation = mesh.rotation;
  if (Number.isFinite(mesh.width) && mesh.width > 0) sprite.width = mesh.width;
  if (Number.isFinite(mesh.height) && mesh.height > 0) sprite.height = mesh.height;
  if (Number.isFinite(mesh.tint)) sprite.tint = mesh.tint;
  // Render ONLY tokens that Foundry already allows this client to see.
  sprite.visible = token.visible !== false && (!doc.hidden || Boolean(game.user?.isGM));
  // The copy uses normal native token transparency; not the underwater fade.
  const savedNativeAlpha = alphaOverrides.get(mesh)?.nativeAlpha;
  sprite.alpha = Math.max(0, Math.min(1,
    finite(savedNativeAlpha, finite(mesh.alpha, finite(doc.alpha, 1)))));
}

function ensureOverlay(token) {
  const parent = ensureOverlayLayer();
  if (!parent || !token?.mesh?.texture) return false;
  let sprite = overlaySprites.get(token);
  if (!sprite) {
    sprite = new PIXI.Sprite(token.mesh.texture);
    sprite.name = MODULE_ID + "-emerged-" + (token.document?.id ?? "token");
    sprite.eventMode = "none";
    sprite.interactive = false;
    parent.addChild(sprite);
    overlaySprites.set(token, sprite);
    syncOverlaySprite(token, sprite);
    // refreshToken may fire without a preceding scene-wide refresh.
    attachTicker();
    return true;
  }
  syncOverlaySprite(token, sprite);
  return false;
}

function setNativeMeshOpacity(mesh, factor) {
  if (!mesh || !Number.isFinite(mesh.alpha)) return false;
  const existing = alphaOverrides.get(mesh);
  if (factor >= 1 && !existing) return false;
  const record = existing ?? { nativeAlpha: mesh.alpha, applied: null };
  // Foundry may reset token alpha for visibility/hidden status when redrawn.
  if (record.applied !== null &&
      Math.abs(mesh.alpha - record.applied) > 1e-5) {
    record.nativeAlpha = mesh.alpha;
  }
  const desired = factor >= 1
    ? record.nativeAlpha
    : record.nativeAlpha * Math.max(0, factor);
  const changed = Math.abs(mesh.alpha - desired) > 1e-5;
  if (changed) mesh.alpha = desired;
  if (factor >= 1) alphaOverrides.delete(mesh);
  else {
    record.applied = desired;
    alphaOverrides.set(mesh, record);
  }
  if (changed && globalThis.canvas?.primary) {
    globalThis.canvas.primary.renderDirty = true;
  }
  return changed;
}

export function refreshTokenWaterVisualDepth(token) {
  const placeable = token?.mesh ? token : (token?.document ?? token)?.object;
  const doc = placeable?.document;
  const mesh = placeable?.mesh;
  if (!doc || !mesh || !globalThis.canvas?.ready) return false;

  const state = getTokenWaterVisualDisplay(doc);
  const enabled = game.settings?.get?.(MODULE_ID, "partialSurfaceDepth") !== false;
  const showEmerged = enabled && state?.mode === "emerged";
  const withinDepth = state?.mode === "submerged" && state.opacity > 0;
  const originalAllowed = placeable.isVisible === true ||
    (placeable.isVisible === undefined && placeable.visible !== false);
  const exteriorAllowed = enabled && (showEmerged || withinDepth) &&
    canSeeWaterTokenFromExterior(placeable);
  let changed = syncWaterTokenVisibility(placeable, exteriorAllowed);
  const allowed = (originalAllowed || exteriorAllowed) &&
    (!doc.hidden || Boolean(game.user?.isGM));

  if (showEmerged && allowed) changed = ensureOverlay(placeable) || changed;
  else changed = removeOverlay(placeable) || changed;

  // When the image copy exists above the tile, hide the original primary
  // sprite to avoid a duplicated translucent token behind the water image.
  const isCopied = showEmerged && allowed && overlaySprites.has(placeable);
  const opacity = isCopied ? 0 : enabled && state?.mode === "submerged" ? state.opacity : 1;
  changed = setNativeMeshOpacity(mesh, opacity) || changed;
  return changed;
}

function tickOverlaySprites() {
  if (!globalThis.canvas?.ready || !layer?.parent) return;
  for (const [token, sprite] of overlaySprites) {
    if (!token?.mesh || !token?.document) {
      removeOverlay(token);
      continue;
    }
    syncOverlaySprite(token, sprite);
  }
}

function attachTicker() {
  const next = globalThis.canvas?.app?.ticker;
  if (!next || typeof next.add !== "function") return;
  if (ticker === next) return;
  detachTicker();
  next.add(tickOverlaySprites);
  ticker = next;
}
function detachTicker() {
  if (ticker && typeof ticker.remove === "function") {
    ticker.remove(tickOverlaySprites);
  }
  ticker = null;
}

export function refreshSceneWaterVisualDepth() {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || refreshing) return 0;
  refreshing = true;
  try {
    const tokens = canvas.tokens?.placeables ?? [];
    const current = new Set(tokens);
    for (const token of [...overlaySprites.keys()]) {
      if (!current.has(token)) removeOverlay(token);
    }
    let changed = 0;
    for (const token of tokens) {
      if (refreshTokenWaterVisualDepth(token)) changed++;
    }
    attachTicker();
    return changed;
  } finally {
    refreshing = false;
  }
}

export function registerWaterVisualDepthHooks() {
  Hooks.on("refreshToken", (token) => { refreshTokenWaterVisualDepth(token); });
  Hooks.on("drawToken", (token) => { refreshTokenWaterVisualDepth(token); });
  Hooks.on("canvasReady", refreshSceneWaterVisualDepth);
  // Foundry may reset token visibility when any observer changes location,
  // even when the water token itself does not move.
  Hooks.on("sightRefresh", refreshSceneWaterVisualDepth);
  Hooks.on("visibilityRefresh", refreshSceneWaterVisualDepth);
  for (const event of [
    "createToken", "updateToken", "deleteToken",
    "createRegion", "updateRegion", "deleteRegion",
    "createTile", "updateTile", "deleteTile",
    "createDrawing", "updateDrawing", "deleteDrawing"
  ]) Hooks.on(event, refreshSceneWaterVisualDepth);
  Hooks.on("canvasTearDown", () => {
    detachTicker();
    for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
      if (token?.mesh) setNativeMeshOpacity(token.mesh, 1);
      syncWaterTokenVisibility(token, false);
    }
    clearOverlays();
    refreshing = false;
  });
}
