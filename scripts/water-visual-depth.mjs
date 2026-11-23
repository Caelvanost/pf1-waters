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
import { areWaterRegionsInSameBody } from "./water-bodies.mjs";

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

/**
 * A surface Tile is a geometric sheet of water, independent of the texture's
 * alpha at the token centre. Foundry's PrimarySpriteMesh.containsCanvasPoint
 * may test pixel transparency: it is unsuitable for translucent water images.
 * Treat the Tile's full rotated rectangle as the linked water footprint.
 *
 * A Drawing still uses its authored shape, because it may be a polygon,
 * ellipse or freehand contour; don't turn arbitrary Drawings into rectangles.
 */
export function surfaceContainsTokenCenter(surface, token) {
  const doc = surface?.document ?? surface;
  const tokenDoc = token?.document ?? token;
  if (!doc?.parent || doc.parent.id !== tokenDoc?.parent?.id) return false;
  const point = tokenCenter(tokenDoc);
  if (doc.documentName === "Tile") {
    // Native TileDocument width/height describe the real tile geometry in px.
    // The image alpha, transparency and texture-alpha hit-tests are ignored.
    return rectContains(doc, point);
  }
  const shape = doc.object?.shape;
  if (typeof shape?.containsCanvasPoint === "function") {
    try { return Boolean(shape.containsCanvasPoint(point)); }
    catch (error) { warnOnce("Test géométrique du dessin indisponible", error); }
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
/**
 * Collect the local user's actual viewing tokens, not every token on the
 * Scene. Other players' tokens must never grant an underwater sight bypass.
 * Active vision sources and currently controlled tokens are considered.
 */
function getLocalWaterObservers() {
  const canvas = globalThis.canvas;
  if (!canvas) return [];
  const controlled = canvas.tokens?.controlled ?? [];
  // An explicitly selected observer defines the current underwater view.
  // Otherwise a separate surface-level vision source could override the
  // selected diver's perspective and incorrectly bypass the depth rule.
  if (controlled.length) return controlled.filter(token =>
    token?.document && token.document.parent?.id === canvas.scene?.id
  );
  const observers = new Set();
  const sources = canvas.effects?.visionSources ?? canvas.visibility?.visionSources;
  const iterator = sources?.values?.() ??
    (Array.isArray(sources) ? sources : []);
  for (const source of iterator) {
    if (source?.active === false) continue;
    const token = source?.object ?? source?.token ?? source?.data?.object;
    if (token?.document) observers.add(token);
  }
  return [...observers].filter((token) =>
    token?.document && token.document.parent?.id === canvas.scene?.id
  );
}

/**
 * Use the actual eye/line-of-sight height when available. In particular,
 * a floating token may cross the water surface while looking out of the water.
 * Its body immersion alone must NOT grant unrestricted underwater vision.
 */
export function getWaterObserverEyeElevation(viewer, state = undefined) {
  const doc = viewer?.document ?? viewer;
  if (Number.isFinite(viewer?.losHeight)) return viewer.losHeight;
  const water = state ?? (doc ? getTokenWaterState(doc) : null);
  // A Document-only observer has no placeable LOS height; its physical
  // top is a conservative exterior-facing fallback for floating bodies.
  return finite(water?.tokenTop, finite(doc?.elevation, 0));
}

/** A truly underwater viewpoint needs immersed body AND eyes below water. */
export function isWaterObserverSubmerged(viewer, state = undefined) {
  const doc = viewer?.document ?? viewer;
  if (!doc) return false;
  const water = state ?? getTokenWaterState(doc);
  return Boolean(water?.inWater && water.region &&
    Number.isFinite(water.surface) &&
    getWaterObserverEyeElevation(viewer, water) < water.surface - EPSILON);
}

/**
 * The depth limit is bypassed only for a viewer whose eyes are underwater
 * inside the SAME WATER BODY (or legacy Region). Floating swimmers looking above the surface use
 * exterior visibility rules, even if their bodies are partly submerged.
 */
export function hasInteriorWaterViewer(targetState) {
  if (!targetState?.inWater || !targetState.region) return false;
  return getLocalWaterObservers().some((viewer) => {
    const state = getTokenWaterState(viewer.document);
    return isWaterObserverSubmerged(viewer, state) &&
      areWaterRegionsInSameBody(state.region,targetState.region);
  });
}

/**
 * Preserve native Foundry LOS, lighting, hidden-token and fog restrictions.
 * Test an ACTUAL underwater point on the target, never the waterline: this
 * avoids outside viewers granting sight by passing a surface-level test.
 *
 * The per-client water opacity bypass is only available with a local active
 * observer in the target's Region, and successful native point visibility.
 */
export function canSeeWaterTokenFromInterior(token, targetState = undefined) {
  const placeable = token?.mesh ? token : (token?.document ?? token)?.object;
  const doc = placeable?.document;
  const state = targetState ?? (doc ? getTokenWaterState(doc) : null);
  if (!doc || !state?.inWater || !state.region ||
      (doc.hidden && !game.user?.isGM) ||
      !hasInteriorWaterViewer(state)) return false;
  const visibility = globalThis.canvas?.visibility;
  if (typeof visibility?.testVisibility !== "function") return false;
  const center = tokenCenter(doc);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return false;
  // Probe just inside the target's body, on the submerged side of the
  // surface. For wholly submerged targets this stays near their top.
  const sample = {
    x: center.x,
    y: center.y,
    elevation: Math.min(
      state.surface - EPSILON * 2,
      Math.max(state.tokenBottom + EPSILON, state.tokenTop - EPSILON)
    )
  };
  try {
    return visibility.testVisibility(sample, {object: placeable}) === true;
  } catch (error) {
    warnOnce("Test de visibilité depuis l'intérieur de l'eau impossible", error);
    return false;
  }
}

/**
 * Exterior viewers can only see a submerged creature within the visibility
 * range configured in its Region (36m/120ft by default).
 */
export function hasExteriorWaterViewer(surface, targetToken = null) {
  const canvas = globalThis.canvas;
  if (!Number.isFinite(surface) || !canvas) return false;
  if (game.user?.isGM && !(canvas.tokens?.controlled?.length)) return true;
  return getLocalWaterObservers().some((source) => {
    const doc = source.document;
    const eye = getWaterObserverEyeElevation(source);
    return eye >= surface - EPSILON;
  });
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
/**
 * Show/hide the WHOLE native Token placeable, not just TokenMesh.alpha.
 * A fully occluded creature still had a visible parent container and
 * therefore leaked its name, status icons, elevation tooltip and HUD.
 *
 * Do not use TokenDocument.hidden: it is a persistent, shared world flag.
 * Token.visible is purely client-local and hides all PIXI descendants.
 * The original visibility of the placeable and mesh is preserved so the
 * module restores it correctly after resurfacing or changing observers.
 */
function syncWaterTokenVisibility(placeable, canShow, forceHide = false) {
  if (!placeable?.document) return false;
  const existing = nativeVisibilityOverrides.get(placeable);
  const native = typeof placeable.isVisible === "boolean"
    ? placeable.isVisible : (existing?.nativeVisible ?? placeable.visible !== false);

  if (forceHide) {
    if (!existing) nativeVisibilityOverrides.set(placeable, {
      nativeVisible: placeable.visible !== false,
      meshVisible: placeable.mesh?.visible !== false
    });
    const changed = placeable.visible !== false ||
      (placeable.mesh && placeable.mesh.visible !== false);
    // Do not alter individual child flags. Parent visibility removes the
    // token portrait and all its labels/HUD/status elements in one operation.
    placeable.visible = false;
    if (placeable.mesh) placeable.mesh.visible = false;
    return Boolean(changed);
  }

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
    const desiredMesh = desired && existing.meshVisible;
    const changed = placeable.visible !== desired ||
      (placeable.mesh && placeable.mesh.visible !== desiredMesh);
    placeable.visible = desired;
    if (placeable.mesh) placeable.mesh.visible = desiredMesh;
    return Boolean(changed);
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
  // Convert the native mesh's world transform into the overlay container's
  // local coordinates. Different Foundry canvas groups can have distinct
  // parent transforms; directly copying mesh.position may shift the replica.
  let placed = false;
  if (typeof mesh.getGlobalPosition === "function" &&
      typeof sprite.parent?.toLocal === "function") {
    try {
      const world = mesh.getGlobalPosition();
      const local = sprite.parent.toLocal(world);
      if (Number.isFinite(local?.x) && Number.isFinite(local?.y)) {
        copyPoint(sprite.position, local);
        placed = true;
      }
    } catch (error) {
      warnOnce("Conversion des coordonnées du token impossible", error);
    }
  }
  if (!placed) copyPoint(sprite.position, mesh.position,
    finite(doc.x), finite(doc.y));
  copyPoint(sprite.scale, mesh.scale, 1, 1);
  copyPoint(sprite.pivot, mesh.pivot, 0, 0);
  if (Number.isFinite(mesh.rotation)) sprite.rotation = mesh.rotation;
  if (Number.isFinite(mesh.width) && mesh.width > 0) sprite.width = mesh.width;
  if (Number.isFinite(mesh.height) && mesh.height > 0) sprite.height = mesh.height;
  if (Number.isFinite(mesh.tint)) sprite.tint = mesh.tint;
  // Render ONLY tokens that Foundry already allows this client to see.
  sprite.visible = token.visible !== false && (!doc.hidden || Boolean(game.user?.isGM));
  sprite.renderable = sprite.visible;
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
  const water = getTokenWaterState(doc);
  // Interior sight has no artificial depth cap. Still require the actual
  // target-point LOS test from Foundry to avoid revealing tokens through
  // walls, fog, darkness or the hidden flag.
  const interiorAllowed = enabled && water.inWater &&
    canSeeWaterTokenFromInterior(placeable, water);
  const showEmerged = enabled && state?.mode === "emerged";
  const withinDepth = state?.mode === "submerged" && state.opacity > 0;
  // A preceding depth refresh may have locally hidden the Token. Use the
  // saved native visibility rather than treating our override as a native
  // Foundry LOS rejection.
  const native = nativeVisibilityOverrides.get(placeable);
  const originalAllowed = typeof placeable.isVisible === "boolean"
    ? placeable.isVisible
    : (native?.nativeVisible ?? placeable.visible !== false);
  const exteriorAllowed = enabled && (showEmerged || withinDepth) &&
    canSeeWaterTokenFromExterior(placeable);
  // Restrict only when the underwater target lies beyond its exterior
  // visibility range, no valid underwater viewer shares its Region and a
  // water-facing view is active. A free-camera GM can still inspect tokens.
  const exteriorTooDeep = enabled && state?.mode === "submerged" &&
    state.opacity <= 0 && !interiorAllowed &&
    (!game.user?.isGM ||
      getLocalWaterObservers().length > 0);
  let changed = syncWaterTokenVisibility(
    placeable, interiorAllowed || exteriorAllowed, exteriorTooDeep
  );
  const allowed = (originalAllowed || exteriorAllowed) &&
    (!doc.hidden || Boolean(game.user?.isGM));

  if (showEmerged && allowed) changed = ensureOverlay(placeable) || changed;
  else changed = removeOverlay(placeable) || changed;

  // When the image copy exists above the tile, hide the original primary
  // sprite to avoid a duplicated translucent token behind the water image.
  const isCopied = showEmerged && allowed && overlaySprites.has(placeable);
  const opacity = isCopied ? 0 : enabled && state?.mode === "submerged"
    ? (interiorAllowed ? 1 : state.opacity) : 1;
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
