import { MODULE_ID } from "./constants.mjs";
import { registerWaterSurfaceHooks, registerWaterSurfaceSceneControls, syncSceneWaterSurfaceElevations } from "./water-surface-links.mjs";
import { WATER_API } from "./api.mjs";
import {
  migrateLegacyWaterRegions, registerWaterRegionHooks,
  registerWaterRegionSceneControls
} from "./water-regions.mjs";
import { registerWaterMovementHooks, syncSceneUnderwaterFlags } from "./water-movement.mjs";
import { registerWaterRenderingHooks, refreshWaterSurfaceMarkers } from "./water-rendering.mjs";

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "showSurfaceMarkers", {
    name: "PF1W.MarkersName",
    hint: "PF1W.MarkersHint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => refreshWaterSurfaceMarkers()
  });
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = WATER_API;

  registerWaterMovementHooks();
  registerWaterRenderingHooks();
  registerWaterSurfaceHooks();
  registerWaterRegionHooks(async (scene) => {
    await syncSceneUnderwaterFlags(scene);
    refreshWaterSurfaceMarkers();
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
    refreshWaterSurfaceMarkers();
  } catch (error) {
    console.error(MODULE_ID + " | Initialisation aquatique impossible", error);
  }
});
