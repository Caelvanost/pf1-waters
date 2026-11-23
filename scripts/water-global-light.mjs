/**
 * PF1 Waters — client-local visual falloff of Scene global illumination.
 *
 * Foundry v13 uses a 2D scene canvas, not a volumetric lightmap. We therefore
 * model the water-column darkness from this user's active underwater viewpoint.
 * Render a non-interactive, Region-shaped dark overlay in InterfaceCanvasGroup.
 * The former PrimaryCanvasGroup placement was subject to Foundry's cached
 * primary sprite composition and could fail to appear during elevation
 * updates. Interface renders after the Scene's lighting, guaranteeing visible
 * local darkening; this is a graphical simulation, not a volumetric lightmap.
 * Never edit Scene illumination, AmbientLight, TokenDocument or Region data.
 */
import { MODULE_ID, finite } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import {
  getWaterObserverEyeElevation, isWaterObserverSubmerged
} from "./water-visual-depth.mjs";
import { getWaterRegionData, getWaterDepthBandSettings } from "./water-regions.mjs";
import { hasWaterDarkvision } from "./water-senses.mjs";
import { waterSunlightTransmission, waterVisualLightResponse } from "./water-optics.mjs";
export { hasWaterDarkvision } from "./water-senses.mjs";

const shades = new Map();
let layer = null;
let refreshing = false;
const warnings = new Set();

/**
 * The sunlight model uses measured-light exponential decay; the visual pass
 * uses an approximate perception/display gamma rather than asserting a hard
 * "no vision at 12% daylight" rule. PF1 darkvision is handled separately.
 */
export function perceivedWaterGlobalLightFactor(factor,darkvision=false){
  return darkvision ? 1 : waterVisualLightResponse(factor);
}

function warnOnce(message, error) {
  if (warnings.has(message)) return;
  warnings.add(message);
  console.warn(MODULE_ID + " | " + message, error ?? "");
}

/** v13 Scene schema: only enabled global light activates this effect. */
export function hasSceneGlobalIllumination(scene) {
  return scene?.environment?.globalLight?.enabled === true;
}

/**
 * Sunlight decays approximately exponentially in homogeneous water.
 * The Scene body half-depth is the distance producing 50% transmission.
 * Native PF1 lights and the water's fixed sight range are independent.
 */
export function globalWaterLightFactor(depth,halfDepth){
  return waterSunlightTransmission(depth,halfDepth);
}

function localWaterViewers() {
  const canvas = globalThis.canvas;
  if (!canvas) return [];
  // Free-camera GMs see the unmodified Scene. A controlled GM token uses
  // the underwater viewpoint, as do a player's active vision sources.
  if (game.user?.isGM && !(canvas.tokens?.controlled?.length)) return [];
  const controlled = canvas.tokens?.controlled ?? [];
  // The controlled token is the current point of view. Do not mix in other
  // active sight sources (possibly on deck), which can lock the lighting at
  // the shallower token's illumination even while the diver descends.
  if (controlled.length) return controlled.filter(token =>
    token?.document?.parent?.id === canvas.scene?.id &&
    (!token.document.hidden || Boolean(game.user?.isGM))
  );
  const tokens = new Set();
  const vision = canvas.effects?.visionSources ?? canvas.visibility?.visionSources;
  const iterator = vision?.values?.() ?? (Array.isArray(vision) ? vision : []);
  for (const source of iterator) {
    if (source?.active === false) continue;
    const token = source?.object ?? source?.token ?? source?.data?.object;
    if (token?.document) tokens.add(token);
  }
  return [...tokens].filter(token =>
    token?.document?.parent?.id === canvas.scene?.id &&
    (!token.document.hidden || Boolean(game.user?.isGM))
  );
}

/**
 * Select the shallowest local viewer per water Region. The unified 2D
 * canvas cannot show several depths independently for one Region; the
 * least restrictive point of view is the safest choice for shared vision.
 */
export function getWaterRegionGlobalLightStates(
  scene = globalThis.canvas?.scene,
  viewers = localWaterViewers()
) {
  if (!hasSceneGlobalIllumination(scene)) return [];
  const states = new Map();
  for (const token of viewers) {
    const state = getTokenWaterState(token.document);
    if (!isWaterObserverSubmerged(token, state) || !state.region ||
        state.region.parent?.id !== scene?.id) continue;
    const eye = getWaterObserverEyeElevation(token, state);
    const depth = Math.max(0, state.surface - eye);
    const { visibilityDepth, sunlightHalfDepth } = getWaterRegionData(state.region);
    const factor = globalWaterLightFactor(depth, sunlightHalfDepth);
    const darkvision = hasWaterDarkvision(token);
    const perceivedFactor = perceivedWaterGlobalLightFactor(
      factor, darkvision
    );
    const previous = states.get(state.region.id);
    if (!previous || perceivedFactor > previous.perceivedFactor) {
      states.set(state.region.id, {
        region: state.region, regionId: state.region.id,
        depth, visibilityDepth, sunlightHalfDepth, cutoff: 20*sunlightHalfDepth,
        factor, perceivedFactor, darkvision,
        darkness: 1-perceivedFactor
      });
    }
  }
  return [...states.values()];
}

function clearLayer() {
  for (const graphic of shades.values()) {
    graphic.parent?.removeChild?.(graphic);
    graphic.destroy?.({children:false});
  }
  shades.clear();
  layer?.parent?.removeChild?.(layer);
  layer?.destroy?.({children:false});
  layer = null;
}

function ensureLayer() {
  const canvas = globalThis.canvas;
  if (!canvas?.ready || !canvas.interface || !globalThis.PIXI?.Container)
    return null;
  if (layer?.parent === canvas.interface && !layer.destroyed) return layer;
  clearLayer();
  layer = new PIXI.Container();
  layer.name = MODULE_ID + "-underwater-global-light";
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  // In Foundry v13 the Interface group renders after the map. Insert at
  // its end, ABOVE earlier ripple/foreground token replicas: those copies
  // must not keep the same brightness when global light becomes too weak.
  layer.zIndex = 1000000;
  layer.visible = true;
  layer.renderable = true;
  canvas.interface.addChild(layer);
  return layer;
}

/**
 * Draw the Region triangulation (holes already removed), never its bounding
 * rectangle. If geometry is missing, leave the Region unchanged.
 */
function drawRegionDarkness(graphic, region) {
  const geometry = region?.triangulation;
  if (!geometry?.vertices?.length || !geometry?.indices?.length ||
      geometry.indices.length % 3 !== 0 ||
      typeof graphic.poly !== "function" ||
      typeof graphic.fill !== "function") {
    warnOnce("Triangulation de Region aquatique absente : assombrissement impossible");
    return false;
  }
  graphic.clear?.();
  const v = geometry.vertices, indices = geometry.indices;
  try {
    for (let i=0;i<indices.length;i+=3) {
      const a=indices[i]*2, b=indices[i+1]*2, c=indices[i+2]*2;
      const triangle=[v[a],v[a+1],v[b],v[b+1],v[c],v[c+1]];
      if (!triangle.every(Number.isFinite)) return false;
      graphic.poly(triangle).fill({color:0x000000});
    }
    return true;
  } catch(error) {
    graphic.clear?.();
    warnOnce("Impossible de dessiner la zone de lumière aquatique",error);
    return false;
  }
}

/** Read-only per-client diagnostic for real Foundry scenes. */
export function waterLightingDiagnostics() {
  const canvas=globalThis.canvas;
  const viewers=localWaterViewers();
  const states=getWaterRegionGlobalLightStates(canvas?.scene,viewers);
  return {
    globalLightEnabled:hasSceneGlobalIllumination(canvas?.scene),
    selectedTokenCount:canvas?.tokens?.controlled?.length ?? 0,
    observers:viewers.map(token=>({
      id:token.document?.id,
      elevation:token.document?.elevation,
      losHeight:token.losHeight,
      visionMode:token.document?.sight?.visionMode ?? null,
      darkvision:hasWaterDarkvision(token),
      inWater:getTokenWaterState(token.document).inWater
    })),
    regions:states.map(item=>({
      regionId:item.regionId,depth:item.depth,
      visibilityDepth:item.visibilityDepth,
      sunlightHalfDepth:item.sunlightHalfDepth,
      physicalLightPercent:100*item.factor,
      perceivedLightPercent:100*item.perceivedFactor,
      darknessAlpha:item.darkness,
      darkvision:item.darkvision
    })),
    overlayAttached:layer?.parent===canvas?.interface,
    overlayCount:shades.size,
    overlayMode:"client-visual-fallback",
    sourceRegions:states.map(s=>s.regionId)
  };
}

/** Refresh local, visual-only darkness without changing Foundry's light sources. */
export function refreshWaterGlobalLighting() {
  const canvas=globalThis.canvas;
  if (!canvas?.ready || refreshing) return 0;
  refreshing=true;
  try {
    if (!hasSceneGlobalIllumination(canvas.scene)) {
      clearLayer();
      return 0;
    }
    // The built-in Region behavior, when present, replaces the old black
    // sprite entirely. Native darkness participates in Foundry light/vision.
    // Native V13 Adjust Darkness Level Regions do not necessarily rebuild
    // their lighting texture when their DataModel is locally updateSource()'d.
    // In earlier releases, the *presence* of that managed behavior prevented
    // this visual layer from rendering at all. Since PF1 Waters automatically
    // installs such a behavior, depth changes appeared to do nothing.
    //
    // This client-local rendered attenuation MUST be independent of the
    // native Region behavior and of the opt-in altitude bands. Foundry's
    // lighting/vision engine still handles native light sources and sight;
    // this layer is an aesthetic fallback and never changes the world Scene.
    const active=getWaterRegionGlobalLightStates(canvas.scene)
      .filter(item=>item.darkness>0);
    if (!active.length) {
      clearLayer();
      return 0;
    }
    const parent=ensureLayer();
    if (!parent || !globalThis.PIXI?.Graphics) return 0;
    const desired=new Set(active.map(item=>item.regionId));
    for (const [id,graphic] of shades) {
      if (desired.has(id)) continue;
      graphic.parent?.removeChild?.(graphic);
      graphic.destroy?.({children:false});
      shades.delete(id);
    }
    let count=0;
    for (const item of active) {
      let graphic=shades.get(item.regionId);
      if (!graphic) {
        graphic=new PIXI.Graphics();
        graphic.name=MODULE_ID + "-depth-" + item.regionId;
        graphic.eventMode="none";
        if (!drawRegionDarkness(graphic,item.region)) {
          graphic.destroy?.({children:false});
          continue;
        }
        parent.addChild(graphic);
        shades.set(item.regionId,graphic);
      }
      graphic.alpha=item.darkness;
      graphic.visible=true;
      graphic.renderable=true;
      count++;
    }
    // InterfaceCanvasGroup is live: changes to PIXI.Graphics alpha are
    // visible on the next frame, without cached-primary renderDirty.
    return count;
  } finally {
    refreshing=false;
  }
}

export function registerWaterGlobalLightingHooks() {
  for (const name of [
    "canvasReady","sightRefresh","visibilityRefresh","lightingRefresh",
    "refreshToken","drawToken","createToken","updateToken","deleteToken",
    "updateScene"
  ]) Hooks.on(name,refreshWaterGlobalLighting);
  for (const name of ["createRegion","updateRegion","deleteRegion"]) {
    Hooks.on(name,()=>{
      // Regions can change their polygon/hole triangulation as they are edited.
      clearLayer();
      refreshWaterGlobalLighting();
    });
  }
  Hooks.on("canvasTearDown",()=>{
    clearLayer();
    refreshing=false;
  });
}
