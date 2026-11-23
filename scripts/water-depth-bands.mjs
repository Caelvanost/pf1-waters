/**
 * PF1 Waters — opt-in, persisted, elevation-banded native darkness.
 *
 * This is a fallback for Foundry V13 installations where modifying the
 * local RegionBehavior DataModel does not rebuild the native lightmap.
 * Every band is a real Region with its own elevation range and a persisted
 * Adjust Darkness Level / OVERRIDE behavior.
 *
 * These light-only Regions are NEVER flagged as water bodies, so they do not
 * affect swimming, footing, projectiles, surface tiles or water boundaries.
 */
import { MODULE_ID, WATER_REGION_FLAG, LEGACY_MODULE_ID, finite } from "./constants.mjs";
import { getWaterRegionData, isWaterRegion, getWaterDepthBandSettings } from "./water-regions.mjs";
import { globalWaterLightFactor, hasSceneGlobalIllumination } from "./water-global-light.mjs";
import {
  calculateNativeWaterDarkness, syncNativeWaterDarknessBandExclusivity
} from "./water-native-darkness.mjs";

const BAND_FLAG = "waterDepthLightBand";
const MAX_BANDS = 40;
const EPS = 1e-7;
const activeSyncs = new Map();
const scheduled = new Set();
const warnCache = new Set();

const clamp = (value, a, b) => Math.max(a, Math.min(b, value));
function warn(message, error) {
  if (warnCache.has(message)) return;
  warnCache.add(message);
  console.warn(MODULE_ID + " | " + message, error ?? "");
}

export function getWaterDepthBandInfo(region) {
  return region?.getFlag?.(MODULE_ID, BAND_FLAG) ??
    region?.flags?.[MODULE_ID]?.[BAND_FLAG] ?? null;
}

export function isWaterDepthBand(region) {
  return Boolean(getWaterDepthBandInfo(region)?.sourceId);
}

/** Invert the decreasing, piecewise-linear natural light curve. */
function depthForLightFactor(factor, halfDepth, limit) {
  if (factor >= 1) return 0;
  if (factor <= globalWaterLightFactor(limit, halfDepth)) return limit;
  let low = 0, high = limit;
  for (let i = 0; i < 45; i++) {
    const mid = (low + high) / 2;
    if (globalWaterLightFactor(mid, halfDepth) > factor) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Equal changes in brightness rather than equal distances: near-surface
 * strata remain fine, while very deep/dark strata get wider.
 * A final black band extends to the real bottom or -Infinity.
 */
export function planWaterDepthBands(region, scene = region?.parent) {
  if (!region || !scene || !isWaterRegion(region) ||
      !getWaterDepthBandSettings(region).enabled ||
      !hasSceneGlobalIllumination(scene)) return [];

  const { surface, depth, sunlightHalfDepth } = getWaterRegionData(region);
  const waterDepth = depth === null ? Infinity : depth;
  if (waterDepth <= EPS) return [];

  const base = clamp(finite(scene.environment?.darknessLevel, 0), 0, 1);
  if (base >= 1 - EPS) return [];

  const count = clamp(getWaterDepthBandSettings(region).count, 4, MAX_BANDS);
  if (sunlightHalfDepth === 0) return [{
    index: 0, top: surface,
    bottom: Number.isFinite(waterDepth) ? surface - waterDepth : null,
    darkness: 1
  }];

  const cutoff = 20 * sunlightHalfDepth;
  const maxDepth = Math.min(waterDepth, cutoff);
  if (maxDepth <= EPS) return [];

  const minimumFactor = globalWaterLightFactor(maxDepth, sunlightHalfDepth);
  const bands = [];
  let lastDepth = 0;

  for (let index = 0; index < count; index++) {
    const topFactor = 1 - (1 - minimumFactor) * index / count;
    const bottomFactor = 1 - (1 - minimumFactor) * (index + 1) / count;
    const nextDepth = index === count - 1 ? maxDepth :
      depthForLightFactor(bottomFactor, sunlightHalfDepth, maxDepth);
    if (nextDepth - lastDepth < EPS) continue;
    bands.push({
      index, top: surface - lastDepth, bottom: surface - nextDepth,
      darkness: calculateNativeWaterDarkness(base, (topFactor + bottomFactor) / 2)
    });
    lastDepth = nextDepth;
  }

  // The physically remaining volume beyond complete solar extinction.
  if (waterDepth > cutoff + EPS) bands.push({
    index: count, top: surface - cutoff,
    bottom: Number.isFinite(waterDepth) ? surface - waterDepth : null,
    darkness: 1
  });
  return bands;
}

function hash(value) {
  const data = JSON.stringify(value);
  let number = 2166136261;
  for (let i = 0; i < data.length; i++) {
    number ^= data.charCodeAt(i);
    number = Math.imul(number, 16777619);
  }
  return (number >>> 0).toString(16);
}

function sourceShapes(region) {
  const raw = region.toObject?.() ?? null;
  const shapes = raw?.shapes ?? [...(region.shapes ?? [])].map(s => s.toObject?.() ?? s);
  if (!Array.isArray(shapes) || !shapes.length) return null;
  return JSON.parse(JSON.stringify(shapes));
}

function existingForSource(scene, sourceId) {
  return [...(scene?.regions ?? [])]
    .filter(region => getWaterDepthBandInfo(region)?.sourceId === sourceId);
}

async function syncOneSource(scene, sourceId, source) {
  const existing = existingForSource(scene, sourceId);
  const planned = source ? planWaterDepthBands(source, scene) : [];
  const shapes = planned.length && source ? sourceShapes(source) : null;
  if (planned.length && !shapes) {
    warn("La Region aquatique n'a aucune forme copiable : tranches non créées.");
    return {created:0,removed:0,skipped:true};
  }

  const signature = hash({ sourceId, planned, shapes });
  if (existing.length === planned.length &&
      existing.every(b => getWaterDepthBandInfo(b)?.signature === signature)) {
    return {created:0,removed:0,skipped:false};
  }

  if (existing.length) {
    await scene.deleteEmbeddedDocuments("Region", existing.map(b => b.id));
  }
  if (!planned.length) return {created:0,removed:existing.length,skipped:false};

  const created = await scene.createEmbeddedDocuments("Region", planned.map(b => ({
    name: "PF1 Waters — Éclairage " + source.name + " [" + (b.index + 1) + "]",
    shapes: JSON.parse(JSON.stringify(shapes)),
    elevation: { bottom: b.bottom, top: b.top },
    locked: true,
    visibility: 0,
    behaviors: [{
      name: "Obscurité fixe — " + b.darkness.toFixed(3),
      type: "adjustDarknessLevel",
      disabled: false,
      system: { mode: 0, modifier: b.darkness }
    }],
    flags: { [MODULE_ID]: { [BAND_FLAG]: {
      sourceId, index: b.index, signature
    } } }
  })));
  return {created:created?.length ?? 0,removed:existing.length,skipped:false};
}

async function synchronizeScene(scene) {
  if (!scene || !game.user?.isGM ||
      typeof scene.createEmbeddedDocuments !== "function" ||
      typeof scene.deleteEmbeddedDocuments !== "function") {
    return {created:0,removed:0,skipped:true};
  }
  const sources = new Map();
  for (const region of scene.regions ?? []) {
    if (isWaterDepthBand(region)) continue;
    const ownFlag = region.getFlag?.(MODULE_ID, WATER_REGION_FLAG) ??
      region.getFlag?.(LEGACY_MODULE_ID, WATER_REGION_FLAG);
    if (ownFlag !== undefined) {
      // The parent must stop applying darkness BEFORE the light-only
      // strata are created. Restore its previous state when banding
      // is switched off or the water Region itself is disabled.
      await syncNativeWaterDarknessBandExclusivity(region);
      if (isWaterRegion(region)) sources.set(region.id, region);
    }
  }
  const ids = new Set(sources.keys());
  for (const region of scene.regions ?? []) {
    const sourceId = getWaterDepthBandInfo(region)?.sourceId;
    if (sourceId) ids.add(sourceId);
  }
  const result = {created:0,removed:0,skipped:false};
  for (const id of ids) {
    try {
      const next = await syncOneSource(scene, id, sources.get(id));
      result.created += next.created;
      result.removed += next.removed;
    } catch (error) {
      warn("Impossible de synchroniser les tranches d'obscurité de la Region " + id, error);
    }
  }
  return result;
}

export function syncSceneWaterDepthBands(scene = globalThis.canvas?.scene) {
  if (!scene || !game.user?.isGM) return Promise.resolve({created:0,removed:0,skipped:true});
  if (activeSyncs.has(scene.id)) return activeSyncs.get(scene.id);
  const job = synchronizeScene(scene).finally(() => activeSyncs.delete(scene.id));
  activeSyncs.set(scene.id, job);
  return job;
}

function scheduleScene(scene) {
  if (!scene || !game.user?.isGM || scheduled.has(scene.id)) return;
  scheduled.add(scene.id);
  setTimeout(() => {
    scheduled.delete(scene.id);
    void syncSceneWaterDepthBands(scene).catch(error =>
      warn("Synchronisation des tranches d'éclairage échouée", error));
  }, 80);
}

export function registerWaterDepthBandHooks() {
  for (const event of ["createRegion", "updateRegion", "deleteRegion"]) {
    Hooks.on(event, region => {
      if (isWaterDepthBand(region)) return;
      const ownFlag = region?.getFlag?.(MODULE_ID, WATER_REGION_FLAG) ??
        region?.getFlag?.(LEGACY_MODULE_ID, WATER_REGION_FLAG);
      if (ownFlag !== undefined) scheduleScene(region.parent);
    });
  }
  Hooks.on("updateRegionBehavior", behavior => {
    const parent=behavior?.parent;
    if (!parent || isWaterDepthBand(parent)) return;
    // Also repair a manual re-enable of "Obscurité selon profondeur".
    if (getWaterDepthBandSettings(parent).enabled &&
        behavior?.getFlag?.(MODULE_ID,"nativeWaterDepth")===true) {
      scheduleScene(parent.parent);
    }
  });
  Hooks.on("updateScene", (scene, changes) => {
    const bodyChanges=changes?.flags?.[MODULE_ID]?.waterBodies ??
      changes?.[`flags.${MODULE_ID}.waterBodies`] ??
      changes?.[`flags.${MODULE_ID}`]?.waterBodies;
    if (changes?.environment || changes?.grid ||
        bodyChanges !== undefined) scheduleScene(scene);
  });
  Hooks.on("canvasReady", sceneOrCanvas => {
    const scene = sceneOrCanvas?.scene ?? globalThis.canvas?.scene;
    scheduleScene(scene);
  });
}

export function waterDepthBandDiagnostics(scene=globalThis.canvas?.scene) {
  return [...(scene?.regions ?? [])]
    .filter(isWaterDepthBand)
    .map(region => ({
      id:region.id,
      sourceId:getWaterDepthBandInfo(region).sourceId,
      elevation:region.elevation,
      darkness:[...(region.behaviors ?? [])]
        .find(b => b.type === "adjustDarknessLevel")?.system?.modifier ?? null
    }));
}
