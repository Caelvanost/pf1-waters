import {
  MODULE_ID, LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG, UNDERWATER_FLAG,
  EPSILON, finite, canWriteToken
} from "./constants.mjs";
import { getWaterRegionData, getWaterBottomElevation, getWaterRegionsAtToken2D } from "./water-regions.mjs";
import { getTokenSwimElevation, getTokenWaterState, isFlyingMovement, tokenHasFooting } from "./water-state.mjs";

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
    const region = getWaterRegionsAtToken2D(doc).find((candidate) => {
      const floor = getWaterBottomElevation(candidate);
      // Choose the water volume that contains the token, if applicable.
      return finite(doc.elevation) < getWaterRegionData(candidate).surface &&
        (floor === null || finite(doc.elevation) + getTokenWaterState(doc).tokenHeight > floor);
    }) ?? getWaterRegionsAtToken2D(doc)[0] ?? null;
    const flying = isFlyingMovement(doc);

    if (flying || !region) {
      if (wasInWater) await setNativeSwimmingStatus(doc, false);
      if (wasInWater || oldCanonical === undefined && doc.getFlag?.(LEGACY_MODULE_ID, WATER_MOVEMENT_FLAG) !== undefined) {
        const cleared = { inWater: false };
        if (changed(oldCanonical, cleared)) await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, cleared);
      }
      return { ...getTokenWaterState(doc), flying };
    }

    const water = getWaterRegionData(region);
    const swimElevation = getTokenSwimElevation(doc, region);
    const bottom = getWaterBottomElevation(region);
    const surfacePosture = bottom === null ? swimElevation : Math.max(swimElevation, bottom);
    const original = finite(doc.elevation);
    let effective = original;

    // Existing deeper immersion stays unchanged. A non-flyer may not rise
    // above the half-immersed posture, nor sink below a defined physical floor.
    if (bottom !== null && effective < bottom - EPSILON) effective = bottom;
    if (effective > surfacePosture + EPSILON) effective = surfacePosture;

    if (Math.abs(original - effective) > EPSILON) {
      await doc.update({ elevation: effective });
    }

    const standing = tokenHasFooting(doc, region, effective);
    await setNativeSwimmingStatus(doc, !standing);

    const next = {
      inWater: true, standing, regionId: region.id,
      surface: water.surface, depth: water.depth,
      bottomElevation: bottom, swimElevation
    };
    if (force || changed(oldCanonical, next)) {
      await doc.setFlag(MODULE_ID, WATER_MOVEMENT_FLAG, next);
    }
    return { ...getTokenWaterState(doc), standing, swimElevation };
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

export function registerWaterMovementHooks() {
  Hooks.on("updateToken", (token, changes) => {
    if (busy.has(keyOf(token))) return;
    const keys = ["x", "y", "elevation", "width", "height", "movementAction"];
    if (!keys.some((key) => Object.prototype.hasOwnProperty.call(changes ?? {}, key))) return;
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
