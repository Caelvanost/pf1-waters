import { MODULE_ID, EPSILON, finite } from "./constants.mjs";
import { getWaterRegionData, getWaterBottomElevation, getWaterRegionsAtToken2D } from "./water-regions.mjs";

export const WATER_CLASSIFICATION = Object.freeze({
  OUTSIDE_WATER: "OUTSIDE_WATER",
  ABOVE_WATER: "ABOVE_WATER",
  INTERSECTING_SURFACE: "INTERSECTING_SURFACE",
  UNDERWATER: "UNDERWATER",
  BELOW_BOTTOM: "BELOW_BOTTOM"
});

function docOf(token) { return token?.document ?? token; }

export function getTokenPhysicalHeight(token) {
  const doc = docOf(token);
  const override = doc?.getFlag?.(MODULE_ID, "physicalHeight");
  const explicit = Number(override);
  if (override !== null && override !== undefined && override !== "" &&
      Number.isFinite(explicit) && explicit > 0) return explicit;
  const scene = doc?.parent ?? globalThis.canvas?.scene;
  const cellDistance = finite(scene?.grid?.distance, 0);
  const footprint = Math.max(finite(doc?.width, 1), finite(doc?.height, 1));
  return Math.max(0, footprint * cellDistance);
}

export function getTokenSwimElevation(token, region) {
  if (!region) return null;
  return getWaterRegionData(region).surface - getTokenPhysicalHeight(token) / 2;
}

export function tokenHasFooting(token, region, elevation = undefined) {
  if (!token || !region) return false;
  const floor = getWaterBottomElevation(region);
  if (floor === null) return false;
  const z = elevation === undefined ? finite(docOf(token)?.elevation, 0) : finite(elevation, 0);
  return z <= floor + EPSILON;
}

export function isFlyingMovement(token) {
  return String(docOf(token)?.movementAction ?? "").toLowerCase() === "fly";
}

export function getTokenWaterState(token) {
  const doc = docOf(token);
  const elevation = finite(doc?.elevation, 0);
  const tokenHeight = getTokenPhysicalHeight(doc);
  const tokenBottom = elevation;
  const tokenTop = elevation + tokenHeight;
  const candidates = getWaterRegionsAtToken2D(doc);

  // A vertically occupied volume wins over a merely overlapping 2D area.
  const region = candidates.find((candidate) => {
    const water = getWaterRegionData(candidate);
    const floor = getWaterBottomElevation(candidate);
    return tokenBottom < water.surface &&
      (floor === null || tokenTop > floor);
  }) ?? candidates[0] ?? null;

  const flying = isFlyingMovement(doc);
  const empty = {
    inWater: false, underwater: false, region: null, regionId: null,
    surface: null, bottom: null, bottomElevation: null, depth: null,
    tokenBottom, tokenTop, tokenHeight, elevation, immersion: 0,
    intersectsSurface: false, fullySubmerged: false, aboveWater: false,
    standing: false, flying, classification: WATER_CLASSIFICATION.OUTSIDE_WATER
  };
  if (!region) return empty;

  const water = getWaterRegionData(region);
  const bottom = getWaterBottomElevation(region);
  const aboveWater = tokenBottom >= water.surface - EPSILON;
  const belowBottom = bottom !== null && tokenTop <= bottom + EPSILON;
  const inWater = !aboveWater && !belowBottom;
  const overlap = inWater
    ? Math.max(0, Math.min(tokenTop, water.surface) - Math.max(tokenBottom, bottom ?? -Infinity))
    : 0;
  const immersion = tokenHeight > 0 ? Math.min(1, Math.max(0, overlap / tokenHeight)) : 0;
  const intersectsSurface = inWater && tokenBottom < water.surface &&
    tokenTop > water.surface;
  const fullySubmerged = inWater && tokenTop <= water.surface + EPSILON;
  const classification = aboveWater ? WATER_CLASSIFICATION.ABOVE_WATER :
    belowBottom ? WATER_CLASSIFICATION.BELOW_BOTTOM :
    intersectsSurface ? WATER_CLASSIFICATION.INTERSECTING_SURFACE :
    WATER_CLASSIFICATION.UNDERWATER;

  return {
    inWater, underwater: fullySubmerged, region, regionId: region.id,
    surface: water.surface, bottom, bottomElevation: bottom, depth: water.depth,
    tokenBottom, tokenTop, tokenHeight, elevation, immersion,
    intersectsSurface, fullySubmerged, aboveWater,
    standing: inWater && tokenHasFooting(doc, region), flying, classification
  };
}

export function isTokenUnderwater(token) {
  return getTokenWaterState(token).fullySubmerged;
}
