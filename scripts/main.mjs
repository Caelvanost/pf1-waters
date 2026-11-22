import { MODULE_ID } from "./constants.mjs";
import { registerWaterVisualDepthHooks, refreshSceneWaterVisualDepth } from "./water-visual-depth.mjs";
import { registerWaterSurfaceHooks, registerWaterSurfaceSceneControls, syncSceneWaterSurfaceElevations, syncSceneWaterSurfaceVisibilities } from "./water-surface-links.mjs";
import { WATER_API } from "./api.mjs";
import {
  migrateLegacyWaterRegions, registerWaterRegionHooks,
  registerWaterRegionSceneControls
} from "./water-regions.mjs";
import { registerWaterMovementHooks, syncSceneUnderwaterFlags } from "./water-movement.mjs";
import { registerWaterRenderingHooks, refreshWaterSurfaceMarkers } from "./water-rendering.mjs";

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
  registerWaterVisualDepthHooks();
  registerWaterSurfaceHooks();
  registerWaterRegionHooks(async (scene) => {
    await syncSceneUnderwaterFlags(scene);
    await refreshWaterSurfaceMarkers();
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
    const result = await migrateLegacyWaterRegions();
    if (result.migrated) console.info(MODULE_ID + " | Regions migrées : " + result.migrated);
    await syncSceneUnderwaterFlags(globalThis.canvas?.scene);
    await syncSceneWaterSurfaceElevations(globalThis.canvas?.scene);
    await syncSceneWaterSurfaceVisibilities(globalThis.canvas?.scene);
    refreshSceneWaterVisualDepth();
    await refreshWaterSurfaceMarkers();
  } catch (error) {
    console.error(MODULE_ID + " | Initialisation aquatique impossible", error);
  }
});
