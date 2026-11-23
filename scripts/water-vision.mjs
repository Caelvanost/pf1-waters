/**
 * PF1 Waters — per-token underwater vision limit for Foundry V13 / PF1 v11.11.
 *
 * One client's PointVisionSource is clipped independently of other viewers.
 * Limits are in scene distance units; source data uses canvas pixels.
 * Neither TokenDocument.sight nor ambient / emitted light sources are changed.
 *
 * Foundry's normal walls, illumination, detection modes and vision modes
 * continue to decide what can be seen INSIDE the permitted radius.
 */
import { MODULE_ID, EPSILON } from "./constants.mjs";
import { getSceneWaterBody, getRegionWaterBodyId } from "./water-bodies.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getWaterObserverEyeElevation } from "./water-visual-depth.mjs";

const PATCHED = Symbol.for("pf1-waters.vision-source-patched");
let pendingAll = false;
const pendingTokens = new Set();
let scheduled = false;
let warningIssued = false;

/** Water clarity curve: 100% at the surface, 50% at 1x, 25% at 2x,
 *  5% at 5x and zero at 20x the configured half-depth.
 *  This is a visibility cap, not a change to light emitted by a token.
 */
export function waterVisionFraction(depth, halfDepth) {
  if (!Number.isFinite(depth) || depth <= 0) return 1;
  if (!Number.isFinite(halfDepth) || halfDepth <= 0) return 0;
  const ratio = depth / halfDepth;
  const knots = [[0, 1], [1, .5], [2, .25], [5, .05], [20, 0]];
  for (let i = 1; i < knots.length; i++) {
    const [end, value] = knots[i];
    if (ratio <= end) {
      const [start, previous] = knots[i - 1];
      return Math.max(0, Math.min(1,
        previous + (value - previous) * (ratio - start) / (end - start)));
    }
  }
  return 0;
}

/** Return the limit for one viewer, or null when the original vision is kept. */
export function getTokenUnderwaterVisionLimit(token) {
  const placeable = token?.document ? token : token?.object ?? token;
  const doc = placeable?.document ?? token?.document ?? token;
  const scene = doc?.parent;
  const canvas = globalThis.canvas;
  if (!doc || !scene || (canvas?.scene && scene.id !== canvas.scene.id)) return null;

  const state = getTokenWaterState(placeable);
  if (!state.inWater || !state.region) return null;
  const bodyId = getRegionWaterBodyId(state.region);
  const body = getSceneWaterBody(scene, bodyId);
  if (!body || !body.visionEnabled) return null;

  // Never reduce vision for a swimmer who is looking out into the air.
  // Foundry Token.losHeight is used when available; in tests / documents
  // without a canvas placeable, tokenTop is the conservative fallback.
  const eyeElevation = getWaterObserverEyeElevation(placeable, state);
  if (!Number.isFinite(eyeElevation) ||
      eyeElevation >= state.surface - EPSILON) return null;

  const depth = state.surface - eyeElevation;
  const fraction = waterVisionFraction(depth, body.visionHalfDepth);
  const range = Math.max(0, body.visionRange * fraction);
  return {
    bodyId, bodyName: body.name, surface: state.surface, eyeElevation,
    depth, range, maxRange: body.visionRange, halfDepth: body.visionHalfDepth,
    fraction
  };
}

export function waterVisionPixels(range, scene) {
  const size = Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size);
  const distance = Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance);
  if (!(size > 0) || !(distance > 0) || !Number.isFinite(range) || range < 0) {
    return null;
  }
  return range * size / distance;
}

/**
 * Foundry V13 PointVisionSource uses two related radii in pixels:
 * radius controls unrestricted vision, lightRadius controls perception of
 * illuminated areas. Capping both avoids distant torches allowing a diver
 * to see beyond the underwater transparency limit. We do not modify
 * Token.light, ambient lights or the Scene's darkness.
 */
export function constrainWaterVisionSourceData(token, data) {
  if (!data || typeof data !== "object") return data;
  const limit = getTokenUnderwaterVisionLimit(token);
  if (!limit) return data;
  const scene = (token?.document ?? token)?.parent;
  const pixels = waterVisionPixels(limit.range, scene);
  if (pixels === null) return data;

  const capped = { ...data };
  for (const field of ["radius", "lightRadius"]) {
    const previous=data[field]===null||data[field]===undefined
      ?NaN:Number(data[field]);
    capped[field]=Number.isFinite(previous)&&previous>=0
      ?Math.min(previous,pixels):pixels;
  }
  return capped;
}

/**
 * Wrap only the resolved token class used by the installed PF1 system.
 * This preserves other systems' original source-data behavior and does not
 * re-write documents or monkey-patch a shared VisionSource instance.
 */
export function patchWaterTokenVision(tokenClass =
  globalThis.CONFIG?.Token?.objectClass ??
  globalThis.foundry?.canvas?.placeables?.Token ??
  globalThis.Token) {
  const proto = tokenClass?.prototype;
  if (!proto || typeof proto._getVisionSourceData !== "function") {
    if (!warningIssued) {
      warningIssued = true;
      console.warn(MODULE_ID + " | Token._getVisionSourceData introuvable ; la limitation visuelle n'est pas installée.");
    }
    return false;
  }
  if (Object.hasOwn(proto, PATCHED)) return true;
  const previous = proto._getVisionSourceData;
  proto._getVisionSourceData = function (...args) {
    return constrainWaterVisionSourceData(this, previous.apply(this, args));
  };
  Object.defineProperty(proto, PATCHED, {value:true, configurable:false});
  return true;
}

/** Recalculate only vision sources; no TokenDocument updates or light edits. */
export function refreshWaterVisionSources(scene = globalThis.canvas?.scene, tokens = null) {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || !scene || canvas.scene?.id !== scene.id) return 0;
  const targets = tokens ?? canvas.tokens?.placeables ?? [];
  let count = 0;
  for (const token of targets) {
    if (!token?.document || token.document.parent?.id !== scene.id ||
        typeof token.initializeVisionSource !== "function") continue;
    try {
      token.initializeVisionSource();
      count++;
    } catch (error) {
      console.warn(MODULE_ID + " | Vision aquatique impossible pour " +
        (token.document.name ?? token.document.id), error);
    }
  }
  if (count) {
    // Re-render light perception and fog with the new source polygons.
    canvas.perception?.update?.({refreshVision:true, refreshLighting:true});
  }
  return count;
}

export function scheduleWaterVisionRefresh(token = null) {
  if (token) pendingTokens.add(token);
  else {pendingAll = true;pendingTokens.clear();}
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    const all = pendingAll;
    const tokens = all ? null : [...pendingTokens];
    pendingAll = false;
    pendingTokens.clear();
    refreshWaterVisionSources(globalThis.canvas?.scene, tokens);
  }, 40);
}

export function waterVisionDiagnostics(scene = globalThis.canvas?.scene) {
  return (globalThis.canvas?.tokens?.placeables ?? [])
    .filter(token => token?.document?.parent?.id === scene?.id)
    .map(token => ({
      tokenId:token.document.id, name:token.document.name,
      controlled:Boolean(token.controlled),
      limit:getTokenUnderwaterVisionLimit(token),
      radius:token.vision?.radius ?? token.visionSource?.radius ?? null,
      lightRadius:token.vision?.lightRadius ?? token.visionSource?.lightRadius ?? null
    }));
}

/** Install after PF1 has registered its Token class and initialize hooks. */
export function registerWaterVisionHooks() {
  patchWaterTokenVision();
  Hooks.on("updateToken", (doc, changes) => {
    if (!["x", "y", "elevation", "width", "height", "sight"].some(key =>
      Object.prototype.hasOwnProperty.call(changes ?? {}, key))) return;
    const token = doc?.object;
    if (token) scheduleWaterVisionRefresh(token);
  });
  Hooks.on("controlToken", () => scheduleWaterVisionRefresh());
  Hooks.on("createToken", () => scheduleWaterVisionRefresh());
  Hooks.on("deleteToken", () => scheduleWaterVisionRefresh());
  for (const event of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(event, region => {
      if (region?.parent?.id !== globalThis.canvas?.scene?.id) return;
      // Skip auxiliary lighting bands, which never modify water volume.
      const band = region.getFlag?.(MODULE_ID, "waterDepthLightBand");
      if (band?.sourceId) return;
      scheduleWaterVisionRefresh();
    });
  }
  Hooks.on("updateScene", (scene, changes) => {
    if (scene?.id !== globalThis.canvas?.scene?.id) return;
    const flags = changes?.flags?.[MODULE_ID]?.waterBodies ??
      changes?.[`flags.${MODULE_ID}.waterBodies`] ??
      changes?.[`flags.${MODULE_ID}`]?.waterBodies;
    if (flags !== undefined || changes?.grid) scheduleWaterVisionRefresh();
  });
  Hooks.on("canvasReady", () => scheduleWaterVisionRefresh());
}
