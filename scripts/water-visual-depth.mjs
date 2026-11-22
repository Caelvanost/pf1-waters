/**
 * PF1 Waters v1.2 — visually sort a partially submerged Token above a
 * linked Tile/Drawing surface without altering TokenDocument.elevation.
 *
 * Foundry v13 puts Tokens, Tiles and primary Drawing shapes in the same
 * elevation-sorted PrimaryCanvasGroup. We affect ONLY the token's primary
 * sprite mesh, NEVER its document or the actual water geometry.
 */
import { MODULE_ID, EPSILON, finite } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getWaterSurfacesForRegion } from "./water-surface-links.mjs";
import { tokenCenter } from "./water-regions.mjs";

const overridden = new WeakMap();
const warned = new Set();
let refreshing = false;

function noticeOnce(message, error) {
  if (warned.has(message)) return;
  warned.add(message);
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
 * Only affect a Token if its center is inside the visual footprint.
 * Prefer Foundry's actual primary hit geometry (including masked tiles).
 * The rectangle is a conservative fallback during initialization.
 */
export function surfaceContainsTokenCenter(surface, token) {
  const doc = surface?.document ?? surface;
  const tokenDoc = token?.document ?? token;
  if (!doc?.parent || doc.parent.id !== tokenDoc?.parent?.id) return false;
  const point = tokenCenter(tokenDoc);
  const primary = doc.object?.mesh ?? doc.object?.shape;
  if (typeof primary?.containsCanvasPoint === "function") {
    try { return Boolean(primary.containsCanvasPoint(point)); }
    catch (error) { noticeOnce("Test visuel de surface indisponible", error); }
  }
  const bounds = doc.object?.bounds;
  if (typeof bounds?.contains === "function" && finite(doc.rotation, 0) === 0) {
    return Boolean(bounds.contains(point.x, point.y));
  }
  return rectContains(doc, point);
}

/** A pure, independently testable decision based on the water-state geometry. */
export function calculateWaterVisualElevation(state, visualElevations = []) {
  if (!state?.inWater || !state.intersectsSurface || state.flying) return null;
  if (!(state.tokenBottom < state.surface - EPSILON
    && state.tokenTop > state.surface + EPSILON)) return null;
  const elevations = visualElevations.map(Number).filter(Number.isFinite);
  if (!elevations.length) return null;
  // The token is shown in front of the linked visual(s), not moved in 3D.
  return Math.max(state.surface, ...elevations) + 0.001;
}

export function getTokenWaterVisualElevation(token) {
  const doc = token?.document ?? token;
  const state = getTokenWaterState(doc);
  if (!state.region || !state.intersectsSurface) return null;
  const visuals = getWaterSurfacesForRegion(state.region).filter((surface) =>
    surfaceContainsTokenCenter(surface, doc)
  );
  return calculateWaterVisualElevation(state, visuals.map((surface) =>
    finite(surface.elevation, state.surface)
  ));
}

/**
 * Returns true only if the mesh's sorting elevation actually changed.
 * On exit, restoring the current native doc.elevation avoids stale values
 * when the token has moved underwater while the override was in force.
 */
export function refreshTokenWaterVisualDepth(token) {
  const placeable = token?.mesh ? token : (token?.document ?? token)?.object;
  const doc = placeable?.document;
  const mesh = placeable?.mesh;
  if (!doc || !mesh || !globalThis.canvas?.ready) return false;

  const enabled = game.settings?.get?.(MODULE_ID, "partialSurfaceDepth") !== false;
  const target = enabled ? getTokenWaterVisualElevation(doc) : null;
  const wasOverridden = overridden.has(mesh);
  if (target === null && !wasOverridden) return false;
  const desired = target ?? finite(doc.elevation, 0);
  if (!Number.isFinite(desired) || Math.abs(Number(mesh.elevation) - desired) <= 1e-7) {
    if (target === null && wasOverridden) overridden.delete(mesh);
    return false;
  }

  // Guard: if the primary mesh does not support an elevation setter,
  // skip rather than mutating the Token's gameplay elevation or scene data.
  try {
    mesh.elevation = desired;
    if (Math.abs(Number(mesh.elevation) - desired) > 1e-7) {
      noticeOnce("Le sprite de token ne permet pas le tri par élévation.");
      return false;
    }
  } catch (error) {
    noticeOnce("Modification du tri d'élévation impossible", error);
    return false;
  }
  if (target !== null) overridden.set(mesh, true);
  else overridden.delete(mesh);

  // The primary group owns z-sort; never reparent placeables or patch PIXI.
  const primary = globalThis.canvas?.primary;
  if (typeof primary?.sortChildren === "function") primary.sortChildren();
  if (primary && "renderDirty" in primary) primary.renderDirty = true;
  return true;
}

export function refreshSceneWaterVisualDepth() {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || refreshing) return 0;
  refreshing = true;
  try {
    let changed = 0;
    for (const token of canvas.tokens?.placeables ?? []) {
      if (refreshTokenWaterVisualDepth(token)) changed++;
    }
    return changed;
  } finally {
    refreshing = false;
  }
}

export function registerWaterVisualDepthHooks() {
  Hooks.on("refreshToken", (token) => { void refreshTokenWaterVisualDepth(token); });
  Hooks.on("drawToken", (token) => { void refreshTokenWaterVisualDepth(token); });
  Hooks.on("canvasReady", refreshSceneWaterVisualDepth);

  // Re-evaluate on changes to geometry, links and visual transforms.
  for (const event of [
    "createToken", "updateToken", "deleteToken",
    "createRegion", "updateRegion", "deleteRegion",
    "createTile", "updateTile", "deleteTile",
    "createDrawing", "updateDrawing", "deleteDrawing"
  ]) {
    Hooks.on(event, () => { void refreshSceneWaterVisualDepth(); });
  }
  Hooks.on("canvasTearDown", () => {
    refreshing = false;
  });
}
