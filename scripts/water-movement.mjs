import {
  MODULE_ID, LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG, UNDERWATER_FLAG,
  EPSILON, finite, canWriteToken
} from "./constants.mjs";
import { getWaterRegionData, getWaterBottomElevation, getWaterRegionsAtToken2D } from "./water-regions.mjs";
import { getTokenPhysicalHeight, getTokenSwimElevation, getTokenWaterState, isFlyingMovement, tokenHasFooting, hasWaterWalkFlag } from "./water-state.mjs";

const busy = new Set();
const keyOf = (doc) => doc?.uuid ?? (doc?.parent?.id + "." + doc?.id);

function movementStored(doc) {
  const canonical = doc.getFlag?.(MODULE_ID, WATER_MOVEMENT_FLAG);
  return canonical !== undefined ? canonical :
    doc.getFlag?.(LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG) ?? {};
}

function findNativeSwimStatus() {
  const values = globalThis.CONFIG?.statusEffects;
  const entries = Array.isArray(values) ? values : Object.values(values ?? {});
  const normalize = (str) => String(str ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const ids = new Set(["swim", "swimming"]);
  const words = new Set(["nage", "nager", "natation", "swim", "swimming"]);
  return entries.find((effect) => ids.has(normalize(effect?.id)))?.id ??
    entries.find((effect) => {
      const raw = effect?.name ?? effect?.label;
      const localized = game.i18n?.localize?.(raw) ?? raw;
      return words.has(normalize(raw)) || words.has(normalize(localized));
    })?.id ?? null;
}

export function getNativeSwimmingStatusId() { return findNativeSwimStatus(); }

function actorHasStatus(actor, statusId) {
  if (!actor || !statusId) return false;
  if (actor.statuses?.has?.(statusId)) return true;
  const effects = actor.effects?.contents ?? [...(actor.effects ?? [])];
  return effects.some((effect) => !effect.disabled && effect.statuses?.has?.(statusId));
}

async function setNativeSwimmingStatus(doc, active) {
  const actor = doc?.actor;
  const statusId = findNativeSwimStatus();
  if (!actor || !statusId || typeof actor.toggleStatusEffect !== "function") return false;
  if (actorHasStatus(actor, statusId) === active) return false;
  await actor.toggleStatusEffect(statusId, { active, overlay: false, interaction: false });
  return true;
}

function changed(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }

/**
 * Only a walking token whose base is exactly at the water surface enters
 * the automatic half-height swimming posture. In particular, a token above
 * the water, already submerged, or using another movement type is not moved
 * toward that posture. A waterwalk flag prevents this initial drop; the
 * physical bottom remains a hard lower boundary for submerged tokens.
 */
export async function syncTokenWaterMovement(token, { force = false } = {}) {
  const doc = token?.document ?? token;
  if (!doc || !canWriteToken(doc)) return null;
  const key = keyOf(doc);
  if (busy.has(key)) return null;
  busy.add(key);
  try {
    const old = movementStored(doc);
    const oldCanonical = doc.getFlag?.(MODULE_ID, WATER_MOVEMENT_FLAG);
    const wasInWater = Boolean(old?.inWater);
    const elevation = finite(doc.elevation);
    const tokenHeight = getTokenPhysicalHeight(doc);
    // A Water Walk effect prevents the automatic fall from the surface.
    // It does NOT teleport an already submerged token out of the water.
    const walking = String(doc.movementAction ?? "").trim().toLowerCase() === "walk" &&
      !hasWaterWalkFlag(doc);
    const candidates = getWaterRegionsAtToken2D(doc);

    // Surface entry must be resolved before the ordinary immersed-region
    // selection, notably when multiple Regions overlap in 2D.
    const surfaceEntry = walking
      ? candidates.find((candidate) =>
          Math.abs(elevation - getWaterRegionData(candidate).surface) <= EPSILON)
      : null;
    const occupiedRegion = candidates.find((candidate) => {
      const water = getWaterRegionData(candidate);
      const bottom = getWaterBottomElevation(candidate);
      return elevation < water.surface - EPSILON &&
        (bottom === null || elevation + tokenHeight > bottom + EPSILON);
    });
    const region = surfaceEntry ?? occupiedRegion ?? candidates[0] ?? null;
    const flying = isFlyingMovement(doc);

    if (flying || !region) {
      if (wasInWater) await setNativeSwimmingStatus(doc, false);
      if (wasInWater ||
          (oldCanonical === undefined &&
            doc.getFlag?.(LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG) !== undefined)) {
        const cleared = { inWater: false };
        if (changed(oldCanonical, cleared)) {
          await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, cleared);
        }
      }
      return { ...getTokenWaterState(doc), flying };
    }

    const bottom = getWaterBottomElevation(region);
    let effectiveElevation = elevation;

    // The bottom is a physical collision limit regardless of movement mode,
    // except for flying tokens (handled above).
    if (bottom !== null && effectiveElevation < bottom - EPSILON) {
      effectiveElevation = bottom;
    }

    // This is the ONLY half-height snap. Walking from higher elevations,
    // moving while swimming, or already submerged never triggers it.
    if (surfaceEntry === region) {
      const swimElevation = getTokenSwimElevation(doc, region);
      effectiveElevation = bottom === null
        ? swimElevation
        : Math.max(swimElevation, bottom);
    }

    if (Math.abs(elevation - effectiveElevation) > EPSILON) {
      await doc.update({ elevation: effectiveElevation });
    }

    const state = getTokenWaterState(doc);
    if (!state.inWater) {
      if (wasInWater) await setNativeSwimmingStatus(doc, false);
      if (wasInWater ||
          (oldCanonical === undefined &&
            doc.getFlag?.(LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG) !== undefined)) {
        const cleared = { inWater: false };
        if (changed(oldCanonical, cleared)) {
          await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, cleared);
        }
      }
      return state;
    }

    const effectiveRegion = state.region ?? region;
    const water = getWaterRegionData(effectiveRegion);
    const standing = tokenHasFooting(doc, effectiveRegion, effectiveElevation);
    await setNativeSwimmingStatus(doc, !standing);

    const next = {
      inWater: true,
      standing,
      regionId: effectiveRegion.id,
      surface: water.surface,
      depth: water.depth,
      bottomElevation: getWaterBottomElevation(effectiveRegion),
      swimElevation: getTokenSwimElevation(doc, effectiveRegion)
    };
    if (force || changed(oldCanonical, next)) {
      await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, next);
    }
    return { ...state, standing, swimElevation: next.swimElevation };
  } finally {
    busy.delete(key);
  }
}

export async function syncTokenUnderwaterFlag(token, { force = false } = {}) {
  const doc = token?.document ?? token;
  if (!doc || !canWriteToken(doc)) return false;
  const desired = getTokenWaterState(doc).fullySubmerged;
  const canonical = doc.getFlag?.(MODULE_ID, UNDERWATER_FLAG);
  const legacy = doc.getFlag?.("world", UNDERWATER_FLAG);
  if (force || canonical !== desired) await doc.setFlag(MODULE_ID, UNDERWATER_FLAG, desired);
  if (force || legacy !== desired) await doc.setFlag("world", UNDERWATER_FLAG, desired);
  return desired;
}

export async function syncSceneUnderwaterFlags(scene = globalThis.canvas?.scene) {
  if (!scene) return;
  for (const doc of scene.tokens ?? []) {
    try {
      await syncTokenWaterMovement(doc);
      await syncTokenUnderwaterFlag(doc);
    } catch (error) {
      console.warn(MODULE_ID + " | Synchronisation aquatique impossible : " + doc.name, error);
    }
  }
}

/**
 * Detect only waterwalk changes. Other PF1 Waters flags (waterMovement,
 * underwater) are updated during synchronization and must not re-trigger it.
 * Support Foundry expanded and dotted update paths, including unsetFlag.
 */
export function hasWaterWalkFlagUpdate(changes) {
  const owns = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
  for (const scope of ["world", MODULE_ID]) {
    if (owns(changes, `flags.${scope}.waterwalk`) ||
        owns(changes, `flags.${scope}.-=waterwalk`)) return true;
    const flags = changes?.flags;
    if (owns(flags, `${scope}.waterwalk`) ||
        owns(flags, `${scope}.-=waterwalk`)) return true;
    const scoped = flags?.[scope] ?? changes?.[`flags.${scope}`];
    if (owns(scoped, "waterwalk") || owns(scoped, "-=waterwalk")) return true;
  }
  return false;
}

export function registerWaterMovementHooks() {
  Hooks.on("updateToken", (token, changes) => {
    if (busy.has(keyOf(token))) return;
    const keys = ["x", "y", "elevation", "width", "height", "movementAction"];
    if (!keys.some((key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key)) &&
        !hasWaterWalkFlagUpdate(changes)) return;
    void (async () => {
      try {
        await syncTokenWaterMovement(token);
        await syncTokenUnderwaterFlag(token);
      } catch (error) {
        console.warn(MODULE_ID + " | Impossible de synchroniser le token : " + token.name, error);
      }
    })();
  });
  Hooks.on("createToken", (token) => {
    void (async () => {
      try {
        await syncTokenWaterMovement(token, { force: true });
        await syncTokenUnderwaterFlag(token, { force: true });
      } catch (error) { console.warn(MODULE_ID + " | Initialisation du token impossible", error); }
    })();
  });
  Hooks.on("canvasReady", () => void syncSceneUnderwaterFlags(globalThis.canvas?.scene));
}
