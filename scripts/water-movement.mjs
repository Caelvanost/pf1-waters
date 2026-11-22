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

// Avoid recursively toggling the same Actor's PF1 effect when its
// create/delete hook is fired from toggleStatusEffect itself.
const swimStatusSyncBusy = new WeakSet();

async function setNativeSwimmingStatus(doc, active) {
  const actor = doc?.actor;
  const statusId = findNativeSwimStatus();
  if (!actor || !statusId || typeof actor.toggleStatusEffect !== "function") return false;
  if (swimStatusSyncBusy.has(actor) || actorHasStatus(actor, statusId) === active) return false;
  swimStatusSyncBusy.add(actor);
  try {
    await actor.toggleStatusEffect(statusId, { active, overlay: false, interaction: false });
    return true;
  } finally {
    swimStatusSyncBusy.delete(actor);
  }
}

/**
 * Native PF1 "Nager" is a continuous water posture, not an action:
 * inWater && !hasFooting, regardless of movementAction or token movement.
 * Do not remove unrelated manually applied swim effects on dry tokens that
 * PF1 Waters has never classified as being in water.
 */
export async function syncTokenSwimmingStatus(token) {
  const doc = token?.document ?? token;
  if (!doc || !canWriteToken(doc)) return false;
  const state = getTokenWaterState(doc);
  const previouslyInWater = Boolean(movementStored(doc)?.inWater);
  if (!state.inWater && !previouslyInWater) return false;
  return setNativeSwimmingStatus(doc, state.inWater && !state.hasFooting);
}

export function isNativeSwimEffect(effect) {
  const statusId = findNativeSwimStatus();
  if (!effect || !statusId) return false;
  const ids = effect.statuses ?? effect._source?.statuses;
  return Boolean(ids?.has?.(statusId) ||
    (Array.isArray(ids) && ids.includes(statusId)) ||
    effect.flags?.core?.statusId === statusId);
}

async function resyncActorSwimmingStatus(effect) {
  if (!isNativeSwimEffect(effect)) return;
  const actor = effect?.parent;
  if (!actor) return;
  // Reassert only for tokens of this Actor in the active Scene. Inactive
  // Scenes are reconciled through the existing canvasReady hook.
  for (const doc of globalThis.canvas?.scene?.tokens ?? []) {
    if (doc.actor !== actor &&
        (!doc.actor?.uuid || doc.actor.uuid !== actor.uuid)) continue;
    if (!canWriteToken(doc)) continue;
    await syncTokenSwimmingStatus(doc);
  }
}

function changed(a, b) { return JSON.stringify(a) !== JSON.stringify(b); }

/**
 * Only a walking token whose base is exactly at the water surface enters
 * the automatic half-height swimming posture. In particular, a token above
 * the water, already submerged, or using another movement type is not moved
 * toward that posture. A waterwalk flag prevents this initial drop.
 * Independently, ALL immersed tokens without footing have the native
 * "Nager" condition, even while idle or with another movementAction.
 * Flying only exempts tokens from bottom collision, not from immersion.
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

    if (!region) {
      if (wasInWater) await setNativeSwimmingStatus(doc, false);
      if (wasInWater ||
          (oldCanonical === undefined &&
            doc.getFlag?.(LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG) !== undefined)) {
        const cleared = { inWater: false, floating: false, hasFooting: false };
        if (changed(oldCanonical, cleared)) {
          await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, cleared);
        }
      }
      return { ...getTokenWaterState(doc), flying };
    }

    const bottom = getWaterBottomElevation(region);
    let effectiveElevation = elevation;

    // Flying tokens do not collide with the floor, but if they are physically
    // in the water they still have the "Nager" condition until they have footing.
    if (!flying && bottom !== null && effectiveElevation < bottom - EPSILON) {
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
        const cleared = { inWater: false, floating: false, hasFooting: false };
        if (changed(oldCanonical, cleared)) {
          await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, cleared);
        }
      }
      return state;
    }

    const effectiveRegion = state.region ?? region;
    const water = getWaterRegionData(effectiveRegion);
    const hasFooting = tokenHasFooting(doc, effectiveRegion, effectiveElevation);
    const floating = state.intersectsSurface;
    await setNativeSwimmingStatus(doc, !hasFooting);

    const next = {
      inWater: true,
      hasFooting,
      floating,
      regionId: effectiveRegion.id,
      surface: water.surface,
      depth: water.depth,
      bottomElevation: getWaterBottomElevation(effectiveRegion),
      swimElevation: getTokenSwimElevation(doc, effectiveRegion)
    };
    if (force || changed(oldCanonical, next)) {
      await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, next);
    }
    return { ...state, hasFooting, floating, swimElevation: next.swimElevation };
  } finally {
    busy.delete(key);
  }
}

export async function syncTokenUnderwaterFlag(token, { force = false } = {}) {
  const doc = token?.document ?? token;
  if (!doc || !canWriteToken(doc)) return false;
  const state = getTokenWaterState(doc);
  // This also reconciles an idle token if another PF1 component has removed
  // its native Nager effect since the previous movement update.
  await syncTokenSwimmingStatus(doc);
  const desired = state.fullySubmerged;
  const canonical = doc.getFlag?.(MODULE_ID, UNDERWATER_FLAG);
  const legacy = doc.getFlag?.("world", UNDERWATER_FLAG);
  if (force || canonical !== desired) await doc.setFlag(MODULE_ID, UNDERWATER_FLAG, desired);
  if (force || legacy !== desired) await doc.setFlag("world", UNDERWATER_FLAG, desired);
  // Public flags for spell/item Script Calls: current factual posture,
  // never a persistent status effect. Recompute on every token movement.
  for (const key of ["floating", "hasFooting"]) {
    const value = Boolean(state[key]);
    if (force || doc.getFlag?.(MODULE_ID, key) !== value) {
      await doc.setFlag(MODULE_ID, key, value);
    }
  }
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
  // Reassert/remove Nager when the PF1 Actor's native ActiveEffect changes.
  // A GM can place a token in water and leave it idle indefinitely; another
  // module must not silently remove its swim condition at turn boundaries.
  for (const event of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
    Hooks.on(event, (effect) => {
      if (!isNativeSwimEffect(effect)) return;
      void Promise.resolve().then(() => resyncActorSwimmingStatus(effect))
        .catch((error) => console.warn(
          MODULE_ID + " | Synchronisation du statut Nager impossible", error
        ));
    });
  }
  Hooks.on("canvasReady", () => void syncSceneUnderwaterFlags(globalThis.canvas?.scene));
}
