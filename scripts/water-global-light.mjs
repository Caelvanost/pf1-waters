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

/**
 * Visual underwater sunlight remaining at multiples of the Region's sight
 * depth, with straight-line transitions between the authored milestones:
 *
 *   0× -> 100 %, 1× -> 50 %, 2× -> 25 %, 5× -> 5 %, 20× -> 0 %.
 *
 * Light stays completely extinguished deeper than 20× visibilityDepth.
 * This applies only to the visual global-light layer, not local light sources.
 */
export function globalWaterLightFactor(depth, visibilityDepth) {
  const d = Math.max(0, finite(depth, 0));
  if (!Number.isFinite(visibilityDepth) || visibilityDepth < 0) return 1;
  if (d === 0) return 1;
  if (visibilityDepth === 0) return 0;

  const multiple = d / visibilityDepth;
  const milestones = [
    [0, 1],
    [1, 0.5],
    [2, 0.25],
    [5, 0.05],
    [20, 0]
  ];
  for (let i = 1; i < milestones.length; i++) {
    const [end, endLight] = milestones[i];
    if (multiple <= end) {
      const [start, startLight] = milestones[i - 1];
      const ratio = (multiple - start) / (end - start);
      return Math.max(0, Math.min(1,
        startLight + (endLight - startLight) * ratio
      ));
    }
  }
  return 0;
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
    const visibilityDepth = getWaterRegionData(state.region).visibilityDepth;
    const factor = globalWaterLightFactor(depth, visibilityDepth);
    const previous = states.get(state.region.id);
    if (!previous || factor > previous.factor) {
      states.set(state.region.id, {
        region: state.region, regionId: state.region.id,
        depth, visibilityDepth, cutoff: 20*visibilityDepth,
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
  if (!canvas?.ready || !canvas.interface || !globalThis.PIXI?.Container)
    return null;
  if (layer?.parent === canvas.interface && !layer.destroyed) return layer;
  clearLayer();
  layer = new PIXI.Container();
  layer.name = MODULE_ID + "-underwater-global-light";
  layer.eventMode = "none";
  layer.interactiveChildren = false;
  // The interface pass is always rendered on screen, even if the cached
  // PrimaryCanvasGroup does not redraw after a token elevation change.
  // Place the darkness before foreground replicas of emerged tokens.
  const parent = canvas.interface;
  const replicas = parent.children?.findIndex?.(
    x => x.name === MODULE_ID + "-emerged-token-overlays"
  ) ?? -1;
  if (replicas >= 0 && typeof parent.addChildAt === "function")
    parent.addChildAt(layer, replicas);
  else parent.addChild(layer);
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
