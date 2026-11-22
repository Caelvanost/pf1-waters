import { calculateWaterVisualElevation, surfaceContainsTokenCenter, getTokenWaterVisualElevation, calculateUnderwaterVisualOpacity, getTokenWaterVisualDisplay, hasExteriorWaterViewer, canSeeWaterTokenFromExterior, hasInteriorWaterViewer, canSeeWaterTokenFromInterior, refreshTokenWaterVisualDepth, refreshSceneWaterVisualDepth } from "./water-visual-depth.mjs";
import { getWaterSurfaceData, resolveWaterSurfaceRegion, getWaterSurfacesForRegion, configureSelectedWaterSurfaces, clearSelectedWaterSurfaces, syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations, syncWaterSurfaceVisibility, syncSceneWaterSurfaceVisibilities } from "./water-surface-links.mjs";
import {
  getWaterRegionData, getWaterBottomElevation, isWaterRegion,
  configureSelectedWaterRegions, clearSelectedWaterRegions,
  migrateLegacyWaterRegions
} from "./water-regions.mjs";
import {
  getTokenWaterState, isTokenUnderwater, getTokenPhysicalHeight,
  getTokenSwimElevation, tokenHasFooting, hasWaterWalkFlag, WATER_CLASSIFICATION
} from "./water-state.mjs";
import {
  getNativeSwimmingStatusId, syncTokenWaterMovement, hasWaterWalkFlagUpdate,
  syncTokenUnderwaterFlag, syncSceneUnderwaterFlags
} from "./water-movement.mjs";
import { measureProjectileWaterDistance } from "./water-projectiles.mjs";
import { refreshWaterSurfaceMarkers } from "./water-rendering.mjs";
import {
  hasSceneGlobalIllumination, globalWaterLightFactor,
  getWaterRegionGlobalLightStates, refreshWaterGlobalLighting
} from "./water-global-light.mjs";

export const WATER_AUTOMATION = Object.freeze({
  flagScope: "world",
  flagKey: "underwater",
  getState: getTokenWaterState,
  isUnderwater: isTokenUnderwater,
  getTokenPhysicalHeight,
  getBottomElevation: getWaterBottomElevation,
  getSwimElevation: getTokenSwimElevation,
  hasFooting: tokenHasFooting,
  hasWaterWalkFlag,
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
  hasWaterWalkFlag, hasWaterWalkFlagUpdate,
  getNativeSwimmingStatusId, syncTokenWaterMovement,
  measureProjectileWaterDistance, syncTokenUnderwaterFlag,
  syncSceneUnderwaterFlags, configureSelectedWaterRegions,
  clearSelectedWaterRegions, migrateLegacyWaterRegions,
  refreshWaterSurfaceMarkers,
  hasSceneGlobalIllumination, globalWaterLightFactor,
  getWaterRegionGlobalLightStates, refreshWaterGlobalLighting,
  getWaterSurfaceData, resolveWaterSurfaceRegion, getWaterSurfacesForRegion,
  configureSelectedWaterSurfaces, clearSelectedWaterSurfaces,
  syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations,
  calculateWaterVisualElevation, surfaceContainsTokenCenter,
  getTokenWaterVisualElevation, getTokenWaterVisualDisplay,
  hasExteriorWaterViewer, canSeeWaterTokenFromExterior,
  hasInteriorWaterViewer, canSeeWaterTokenFromInterior,
  calculateUnderwaterVisualOpacity, refreshTokenWaterVisualDepth,
  refreshSceneWaterVisualDepth
});
