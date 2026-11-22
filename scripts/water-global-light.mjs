/**
 * PF1 Waters — client-local visual falloff of Scene global illumination.
 *
 * Foundry v13 uses a 2D scene canvas, not a volumetric lightmap. We therefore
 * model the water-column darkness from this user's active underwater viewpoint.
 * Render a non-interactive, Region-shaped dark overlay in PrimaryCanvasGroup,
 * before native lighting effects. Never edit Scene illumination, AmbientLight,
 * TokenDocument or Region documents.
 */
import { MODULE_ID, finite } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { getWaterRegionData } from "./water-regions.mjs";

const shades = new Map();
let layer = null;
let refreshing = false;
const warnings = new Set();

function warnOnce(message, error) {
  if (warnings.has(message)) return;
  warnings.add(message);
  console.warn(MODULE_ID + " | " + message, error ?? "");
}

/** v13 Scene schema: only enabled global light activates this effect. */
export function hasSceneGlobalIllumination(scene) {
  return scene?.environment?.globalLight?.enabled === true;
}

/** Fraction of sunlight remaining: 100% surface, 50% at D, 0% at 2D. */
export function globalWaterLightFactor(depth, visibilityDepth) {
  const d = Math.max(0, finite(depth, 0));
  if (!Number.isFinite(visibilityDepth) || visibilityDepth < 0) return 1;
  if (visibilityDepth === 0) return d > 0 ? 0 : 1;
  return Math.max(0, Math.min(1, 1 - d / (2 * visibilityDepth)));
}

function localWaterViewers() {
  const canvas = globalThis.canvas;
  if (!canvas) return [];
  // Free-camera GMs see the unmodified Scene. A controlled GM token uses
  // the underwater viewpoint, as do a player's active vision sources.
  if (game.user?.isGM && !(canvas.tokens?.controlled?.length)) return [];
  const tokens = new Set(canvas.tokens?.controlled ?? []);
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
    if (!state.inWater || !state.region ||
        state.region.parent?.id !== scene?.id) continue;
    const eye = Number.isFinite(token.losHeight) ? token.losHeight : state.tokenTop;
    const depth = Math.max(0, state.surface - eye);
    const visibilityDepth = getWaterRegionData(state.region).visibilityDepth;
    const factor = globalWaterLightFactor(depth, visibilityDepth);
    const previous = states.get(state.region.id);
    if (!previous || factor > previous.factor) {
      states.set(state.region.id, {
        region: state.region, regionId: state.region.id,
        depth, visibilityDepth, cutoff: 2*visibilityDepth,
        factor, darkness: 1-factor
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
  if (!canvas?.ready || !canvas.primary || !globalThis.PIXI?.Container)
    return null;
  if (layer?.parent === canvas.primary && !layer.destroyed) return layer;
  clearLayer();
  layer = new PIXI.Container();
  layer.name = MODULE_ID + "-underwater-global-light";
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  layer.zIndex = 100000;
  canvas.primary.addChild(layer);
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
      typeof graphic.fill !== "function") return false;
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
      count++;
    }
    canvas.primary.renderDirty=true;
    return count;
  } finally {
    refreshing=false;
  }
}

export function registerWaterGlobalLightingHooks() {
  for (const name of [
    "canvasReady","sightRefresh","visibilityRefresh","lightingRefresh",
    "refreshToken","drawToken","createToken","updateToken","deleteToken",
    "createRegion","updateRegion","deleteRegion","updateScene"
  ]) Hooks.on(name,refreshWaterGlobalLighting);
  Hooks.on("canvasTearDown",()=>{
    clearLayer();
    refreshing=false;
  });
}
