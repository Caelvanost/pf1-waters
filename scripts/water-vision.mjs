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
import { hasWaterDarkvision } from "./water-senses.mjs";

const PATCHED = Symbol.for("pf1-waters.vision-source-patched");
const RANGE_PATCHED = Symbol.for("pf1-waters.token-range-patched");
const MIN_SOURCE_PIXELS = 1; // V13 interprets a zero polygon radius as unbounded.
let pendingAll = false;
const pendingTokens = new Set();
let scheduled = false;
let warningIssued = false;

/** Natural-light curve: 100% at surface, 50% at 1x, 25% at 2x,
 * 5% at 5x, 0% at 20x. This is NOT an optical-range reduction.
 * Visual darkness and PF1 light perception are processed separately.
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

  const depth=state.surface-eyeElevation;
  const lightFraction=waterVisionFraction(depth,body.visionHalfDepth);
  // Optical transparency and natural light are distinct:
  // a diver with darkvision, a lantern or low-light perception can use
  // whatever illumination the native engine permits, but cannot see
  // beyond this fixed physical water-clarity radius.
  const darkvision=hasWaterDarkvision(placeable);
  return {
    bodyId,bodyName:body.name,surface:state.surface,eyeElevation,
    depth,range:body.visionRange,maxRange:body.visionRange,
    halfDepth:body.visionHalfDepth,lightFraction,darkvision,
    fraction:1
  };
}

export function waterVisionPixels(range, scene) {
  const size = Number(scene?.grid?.size ?? globalThis.canvas?.grid?.size);
  const distance = Number(scene?.grid?.distance ?? globalThis.canvas?.grid?.distance);
  if (!(size > 0) || !(distance > 0) || !Number.isFinite(range) || range < 0) {
    return null;
  }
  return Math.max(MIN_SOURCE_PIXELS,range * size / distance);
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
  // Foundry V13 VisionSourceData only defines lightRadius. A "radius"
  // member may exist in older/extended systems but is NOT authoritative in
  // V13; the actual token sightRange getter is patched below.
  const previous=Number(data.lightRadius);
  capped.lightRadius=data.lightRadius===null||data.lightRadius===undefined||
      !Number.isFinite(previous)||previous<=0
    ?pixels:Math.min(previous,pixels);
  if(Object.hasOwn(data,"radius")){
    const radius=Number(data.radius);
    capped.radius=data.radius===null||data.radius===undefined||
        !Number.isFinite(radius)||radius<=0?pixels:Math.min(radius,pixels);
  }
  return capped;
}

/**
 * Wrap only the resolved token class used by the installed PF1 system.
 * This preserves other systems' original source-data behavior and does not
 * re-write documents or monkey-patch a shared VisionSource instance.
 */
/**
 * The V13 VisionSourceData interface does not have a sight-radius field:
 * Token.sightRange, Token.lightPerceptionRange and Token.optimalSightRange
 * are the authoritative pixel radii. PF1 may subclass these getters; wrap
 * the resolved class and invoke its original getter, never persist a sight
 * change into the TokenDocument.
 */
export function capWaterTokenPixelRange(token,nativeValue) {
  const limit=getTokenUnderwaterVisionLimit(token);
  if(!limit)return nativeValue;
  const pixels=waterVisionPixels(limit.range,token?.document?.parent);
  if(pixels===null)return nativeValue;
  const original=Number(nativeValue);
  // At extreme depths, V13 treats a zero-radius polygon as unbounded in
  // some vision modes. Use one physical pixel rather than a literal zero.
  return Number.isFinite(original)&&original>0
    ?Math.min(original,pixels):pixels;
}

function findPropertyDescriptor(proto,key) {
  for(let cursor=proto;cursor;cursor=Object.getPrototypeOf(cursor)){
    const descriptor=Object.getOwnPropertyDescriptor(cursor,key);
    if(descriptor)return descriptor;
  }
  return null;
}

export function patchWaterTokenRanges(tokenClass) {
  const proto=tokenClass?.prototype;
  if(!proto)return false;
  if(Object.hasOwn(proto,RANGE_PATCHED))return true;
  let count=0;
  for(const key of ["sightRange","lightPerceptionRange","optimalSightRange"]){
    const descriptor=findPropertyDescriptor(proto,key);
    if(typeof descriptor?.get!=="function")continue;
    const get=descriptor.get;
    Object.defineProperty(proto,key,{
      configurable:true,enumerable:descriptor.enumerable,
      get(){return capWaterTokenPixelRange(this,get.call(this));}
    });
    count++;
  }
  if(count)Object.defineProperty(proto,RANGE_PATCHED,{value:true});
  return count>0;
}

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
  patchWaterTokenRanges(tokenClass);
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
