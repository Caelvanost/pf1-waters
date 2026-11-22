import { calculateWaterVisualElevation, surfaceContainsTokenCenter, getTokenWaterVisualElevation, refreshTokenWaterVisualDepth, refreshSceneWaterVisualDepth } from "./water-visual-depth.mjs";
import { getWaterSurfaceData, resolveWaterSurfaceRegion, getWaterSurfacesForRegion, configureSelectedWaterSurfaces, clearSelectedWaterSurfaces, syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations } from "./water-surface-links.mjs";
import {
  getWaterRegionData, getWaterBottomElevation, isWaterRegion,
  configureSelectedWaterRegions, clearSelectedWaterRegions,
  migrateLegacyWaterRegions
} from "./water-regions.mjs";
import {
  getTokenWaterState, isTokenUnderwater, getTokenPhysicalHeight,
  getTokenSwimElevation, tokenHasFooting, WATER_CLASSIFICATION
} from "./water-state.mjs";
import {
  getNativeSwimmingStatusId, syncTokenWaterMovement,
  syncTokenUnderwaterFlag, syncSceneUnderwaterFlags
} from "./water-movement.mjs";
import { measureProjectileWaterDistance } from "./water-projectiles.mjs";
import { refreshWaterSurfaceMarkers } from "./water-rendering.mjs";

export const WATER_AUTOMATION = Object.freeze({
  flagScope: "world",
  flagKey: "underwater",
  getState: getTokenWaterState,
  isUnderwater: isTokenUnderwater,
  getTokenPhysicalHeight,
  getBottomElevation: getWaterBottomElevation,
  getSwimElevation: getTokenSwimElevation,
  hasFooting: tokenHasFooting,
  getNativeSwimmingStatusId,
  syncMovement: syncTokenWaterMovement,
  measureProjectileWaterDistance,
  syncToken: syncTokenUnderwaterFlag,
  syncScene: syncSceneUnderwaterFlags,
  configureSelectedRegions: configureSelectedWaterRegions,
  clearSelectedRegions: clearSelectedWaterRegions
});

export const WATER_API = Object.freeze({
  WATER_CLASSIFICATION,
  waterAutomation: WATER_AUTOMATION,
  getWaterRegionData, isWaterRegion, getTokenWaterState,
  isTokenUnderwater, getTokenPhysicalHeight,
  getWaterBottomElevation, getTokenSwimElevation, tokenHasFooting,
  getNativeSwimmingStatusId, syncTokenWaterMovement,
  measureProjectileWaterDistance, syncTokenUnderwaterFlag,
  syncSceneUnderwaterFlags, configureSelectedWaterRegions,
  clearSelectedWaterRegions, migrateLegacyWaterRegions,
  refreshWaterSurfaceMarkers,
  getWaterSurfaceData, resolveWaterSurfaceRegion, getWaterSurfacesForRegion,
  configureSelectedWaterSurfaces, clearSelectedWaterSurfaces,
  syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations,
  calculateWaterVisualElevation, surfaceContainsTokenCenter,
  getTokenWaterVisualElevation, refreshTokenWaterVisualDepth,
  refreshSceneWaterVisualDepth
});
