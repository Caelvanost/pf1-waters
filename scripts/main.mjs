import { MODULE_ID } from "./constants.mjs";
import { registerWaterVisionHooks, refreshWaterVisionSources } from "./water-vision.mjs";
import { registerWaterVisualDepthHooks, refreshSceneWaterVisualDepth } from "./water-visual-depth.mjs";
import { registerWaterSurfaceHooks, registerWaterSurfaceSceneControls, syncSceneWaterSurfaceElevations, syncSceneWaterSurfaceVisibilities } from "./water-surface-links.mjs";
import { WATER_API } from "./api.mjs";
import {
  registerWaterRegionHooks,registerWaterRegionSceneControls
} from "./water-regions.mjs";
import { registerWaterMovementHooks, syncSceneUnderwaterFlags } from "./water-movement.mjs";
import { registerWaterRenderingHooks, refreshWaterSurfaceMarkers } from "./water-rendering.mjs";
import { registerWaterGlobalLightingHooks, refreshWaterGlobalLighting } from "./water-global-light.mjs";
import {
  registerNativeWaterDarknessHooks, refreshNativeWaterDarkness,
  ensureSceneNativeWaterDarkness
} from "./water-native-darkness.mjs";
import {
  registerWaterDepthBandHooks, syncSceneWaterDepthBands
} from "./water-depth-bands.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "partialSurfaceDepth", {
    name: "PF1W.VisualDepthName",
    hint: "PF1W.VisualDepthHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => refreshSceneWaterVisualDepth()
  });
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = WATER_API;

  registerWaterMovementHooks();
  registerWaterRenderingHooks();
  registerWaterGlobalLightingHooks();
  registerNativeWaterDarknessHooks();
  registerWaterDepthBandHooks();
  registerWaterVisualDepthHooks();
  registerWaterSurfaceHooks();
  registerWaterRegionHooks(async (scene) => {
    await syncSceneUnderwaterFlags(scene);
    await refreshWaterSurfaceMarkers();
  });
  Hooks.on("updateScene", (scene,changes) => {
    const value=changes?.flags?.[MODULE_ID]?.waterBodies ??
      changes?.[`flags.${MODULE_ID}.waterBodies`] ??
      changes?.[`flags.${MODULE_ID}`]?.waterBodies;
    if(value===undefined)return;
    // All members share a changed surface elevation, but their individual
    // depths/footprints remain untouched.
    void syncSceneUnderwaterFlags(scene).catch(error=>
      console.warn(MODULE_ID+" | Corps d’eau non synchronisé",error));
    refreshSceneWaterVisualDepth();
    refreshNativeWaterDarkness();
    refreshWaterGlobalLighting();
  });
  Hooks.on("getSceneControlButtons", registerWaterRegionSceneControls);
  Hooks.on("getSceneControlButtons", registerWaterSurfaceSceneControls);
});

Hooks.once("ready", async () => {
  if (game.system?.id !== "pf1") {
    console.warn(MODULE_ID + " | Ce module nécessite le système Pathfinder 1.");
    return;
  }
  try {
    registerWaterVisionHooks();
    await syncSceneUnderwaterFlags(globalThis.canvas?.scene);
    await syncSceneWaterSurfaceElevations(globalThis.canvas?.scene);
    await syncSceneWaterSurfaceVisibilities(globalThis.canvas?.scene);
    refreshSceneWaterVisualDepth();
    refreshWaterVisionSources();
    await ensureSceneNativeWaterDarkness(globalThis.canvas?.scene);
    await syncSceneWaterDepthBands(globalThis.canvas?.scene);
    refreshNativeWaterDarkness();
    refreshWaterGlobalLighting();
    await refreshWaterSurfaceMarkers();
  } catch (error) {
    console.error(MODULE_ID + " | Initialisation aquatique impossible", error);
  }
});
