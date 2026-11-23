import {
  waterVisionFraction, getTokenUnderwaterVisionLimit, waterVisionPixels,
  constrainWaterVisionSourceData, patchWaterTokenVision,
  patchWaterTokenRanges, capWaterTokenPixelRange,
  getUnderwaterVisionBrightness,hasAppliedUnderwaterVisionBrightness,
  refreshWaterVisionSources, waterVisionDiagnostics
} from "./water-vision.mjs";
import {
  getActiveFogObservers, hasUnderwaterFogObserver,
  patchWaterFogExploration, waterFogDiagnostics
} from "./water-fog.mjs";
import { isWithinUnderwaterVisionRange, isBeyondAllUnderwaterVisionRanges } from "./water-visual-depth.mjs";
import { calculateWaterVisualElevation, surfaceContainsTokenCenter, getTokenWaterVisualElevation, calculateUnderwaterVisualOpacity, getTokenWaterVisualDisplay, hasExteriorWaterViewer, canSeeWaterTokenFromExterior, hasInteriorWaterViewer, canSeeWaterTokenFromInterior, getWaterObserverEyeElevation, isWaterObserverSubmerged, refreshTokenWaterVisualDepth, refreshSceneWaterVisualDepth } from "./water-visual-depth.mjs";
import { getWaterSurfaceData, getWaterSurfacesForRegion, assignSelectedSurfacesToBody, clearSelectedWaterSurfaces, syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations, syncWaterSurfaceVisibility, syncSceneWaterSurfaceVisibilities } from "./water-surface-links.mjs";
import {
  getWaterRegionData, getWaterBottomElevation, isWaterRegion,
  configureSelectedWaterRegions, clearSelectedWaterRegions,
  attachSelectedWaterRegionsToBody, detachSelectedWaterRegionsFromBody
} from "./water-regions.mjs";
import {
  getSceneWaterBodies, getSceneWaterBody, getRegionWaterBody,
  getRegionWaterBodyId, areWaterRegionsInSameBody,
  configureSceneWaterBodies, saveSceneWaterBody, deleteSceneWaterBody,
  getDefaultWaterVisionRange, getDefaultWaterVisionSettings
} from "./water-bodies.mjs";
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
  getWaterRegionGlobalLightStates, refreshWaterGlobalLighting,
  hasWaterDarkvision, perceivedWaterGlobalLightFactor,
  waterLightingDiagnostics
} from "./water-global-light.mjs";
import {
  getNativeWaterDarknessBehavior, ensureNativeWaterDarknessBehavior,
  getNativeWaterDarknessTargets, calculateNativeWaterDarkness,
  refreshNativeWaterDarkness, nativeWaterDarknessDiagnostics
} from "./water-native-darkness.mjs";
import {
  planWaterDepthBands, getWaterDepthBandInfo, waterDepthBandDiagnostics,
  syncSceneWaterDepthBands
} from "./water-depth-bands.mjs";

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
  getDefaultWaterVisionRange, getDefaultWaterVisionSettings,
  waterVisionFraction, getTokenUnderwaterVisionLimit,
  waterVisionPixels, constrainWaterVisionSourceData, patchWaterTokenVision,
  patchWaterTokenRanges, capWaterTokenPixelRange,
  getUnderwaterVisionBrightness,hasAppliedUnderwaterVisionBrightness,
  refreshWaterVisionSources, waterVisionDiagnostics,
  getActiveFogObservers, hasUnderwaterFogObserver,
  patchWaterFogExploration, waterFogDiagnostics,
  isWithinUnderwaterVisionRange, isBeyondAllUnderwaterVisionRanges,
  getSceneWaterBodies, getSceneWaterBody, getRegionWaterBody,
  getRegionWaterBodyId, areWaterRegionsInSameBody,
  configureSceneWaterBodies, saveSceneWaterBody, deleteSceneWaterBody,
  attachSelectedWaterRegionsToBody, detachSelectedWaterRegionsFromBody,
  getWaterRegionData, isWaterRegion, getTokenWaterState,
  isTokenUnderwater, getTokenPhysicalHeight,
  getWaterBottomElevation, getTokenSwimElevation, tokenHasFooting,
  hasWaterWalkFlag, hasWaterWalkFlagUpdate,
  getNativeSwimmingStatusId, syncTokenWaterMovement,
  measureProjectileWaterDistance, syncTokenUnderwaterFlag,
  syncSceneUnderwaterFlags, configureSelectedWaterRegions,
  clearSelectedWaterRegions,
  refreshWaterSurfaceMarkers,
  hasSceneGlobalIllumination, globalWaterLightFactor,
  getWaterRegionGlobalLightStates, refreshWaterGlobalLighting,
  hasWaterDarkvision, perceivedWaterGlobalLightFactor,
  waterLightingDiagnostics,
  getNativeWaterDarknessBehavior, ensureNativeWaterDarknessBehavior,
  getNativeWaterDarknessTargets, calculateNativeWaterDarkness,
  refreshNativeWaterDarkness, nativeWaterDarknessDiagnostics,
  planWaterDepthBands, getWaterDepthBandInfo, waterDepthBandDiagnostics,
  syncSceneWaterDepthBands,
  getWaterSurfaceData,getWaterSurfacesForRegion,assignSelectedSurfacesToBody,
  clearSelectedWaterSurfaces,
  syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations,
  calculateWaterVisualElevation, surfaceContainsTokenCenter,
  getTokenWaterVisualElevation, getTokenWaterVisualDisplay,
  hasExteriorWaterViewer, canSeeWaterTokenFromExterior,
  hasInteriorWaterViewer, canSeeWaterTokenFromInterior,
  getWaterObserverEyeElevation, isWaterObserverSubmerged,
  calculateUnderwaterVisualOpacity, refreshTokenWaterVisualDepth,
  refreshSceneWaterVisualDepth
});
