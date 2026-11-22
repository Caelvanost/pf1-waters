import {
  MODULE_ID, LEGACY_MODULE_ID, WATER_REGION_FLAG, finite, isPrimaryGM, t
} from "./constants.mjs";

function readRegionFlag(region, scope) {
  try { return region?.getFlag?.(scope, WATER_REGION_FLAG); }
  catch (_) { return undefined; }
}

/**
 * Default underwater sight limit: 36 metres in Scene elevation units.
 * No rounding to 120 ft: the configured distance is exactly 36 m.
 */
export function getDefaultWaterVisibilityDepth(scene) {
  const unit = String(scene?.grid?.units ?? "m").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["ft", "ft.", "foot", "feet", "pied", "pieds", "pi"].includes(unit)) {
    return 36 / 0.3048;
  }
  if (["km", "kilometre", "kilometres"].includes(unit)) return 0.036;
  if (["cm", "centimetre", "centimetres"].includes(unit)) return 3600;
  if (["mm", "millimetre", "millimetres"].includes(unit)) return 36000;
  if (["mi", "mile", "miles"].includes(unit)) return 36 / 1609.344;
  return 36;
}

function parseRegionFlag(raw, scene) {
  const surface = finite(raw?.surface, 0);
  const depthRaw = raw?.depth;
  const parsedDepth = depthRaw === "" || depthRaw === null || depthRaw === undefined
    ? null : Number(depthRaw);
  return {
    enabled: Boolean(raw?.enabled),
    surface,
    depth: Number.isFinite(parsedDepth) && parsedDepth >= 0 ? parsedDepth : null,
    // Optional ring image provided by the GM; no default geometric rings.
    ringPng: typeof raw?.ringPng === "string" ? raw.ringPng.trim() : "",
    // A null/missing/invalid value means 36 m, converted to scene units.
    // Explicit zero is valid; it means no subsurface image visibility.
    visibilityDepth: typeof raw?.visibilityDepth === "number" &&
      Number.isFinite(raw.visibilityDepth) && raw.visibilityDepth >= 0
      ? raw.visibilityDepth : getDefaultWaterVisibilityDepth(scene)
  };
}

export function getWaterRegionData(region) {
  const canonical = readRegionFlag(region, MODULE_ID);
  // An explicit canonical disabled value overrides any old enabled value.
  const raw = canonical !== undefined ? canonical : readRegionFlag(region, LEGACY_MODULE_ID);
  return parseRegionFlag(raw, region?.parent);
}

export function getWaterBottomElevation(region) {
  const data = getWaterRegionData(region);
  return data.depth === null ? null : data.surface - data.depth;
}

export function isWaterRegion(region) {
  return getWaterRegionData(region).enabled;
}

export function tokenCenter(token) {
  const doc = token?.document ?? token;
  const center = doc?.object?.center ?? token?.center;
  if (Number.isFinite(center?.x) && Number.isFinite(center?.y)) {
    return { x: center.x, y: center.y };
  }
  const scene = doc?.parent ?? globalThis.canvas?.scene;
  const size = finite(scene?.grid?.size ?? globalThis.canvas?.grid?.size, 0);
  return {
    x: finite(doc?.x) + finite(doc?.width, 1) * size / 2,
    y: finite(doc?.y) + finite(doc?.height, 1) * size / 2
  };
}

export function pointInsideWaterRegion2D(point, region) {
  if (!point || !region) return false;
  try {
    // Supply the Region's own elevation so only horizontal membership is tested.
    return Boolean(region.testPoint({
      x: point.x, y: point.y, elevation: finite(region.elevation, 0)
    }));
  } catch (error) {
    console.warn(MODULE_ID + " | Test géométrique Region impossible", error);
    return false;
  }
}

export function tokenInsideWaterRegion2D(token, region) {
  const doc = token?.document ?? token;
  return Boolean(doc?.parent && region?.parent?.id === doc.parent.id &&
    pointInsideWaterRegion2D(tokenCenter(doc), region));
}

export function getWaterRegionsAtToken2D(token) {
  const doc = token?.document ?? token;
  return [...(doc?.parent?.regions ?? [])]
    .filter(isWaterRegion)
    .filter((region) => tokenInsideWaterRegion2D(doc, region))
    .sort((a, b) => getWaterRegionData(b).surface - getWaterRegionData(a).surface);
}

export async function migrateLegacyWaterRegions() {
  if (!isPrimaryGM()) return { migrated: 0, errors: 0 };
  let migrated = 0;
  let errors = 0;
  for (const scene of game.scenes ?? []) {
    for (const region of scene.regions ?? []) {
      const legacy = readRegionFlag(region, LEGACY_MODULE_ID);
      if (legacy === undefined || readRegionFlag(region, MODULE_ID) !== undefined) continue;
      try {
        await region.setFlag(MODULE_ID, WATER_REGION_FLAG, parseRegionFlag(legacy, scene));
        migrated++;
      } catch (error) {
        errors++;
        console.warn(MODULE_ID + " | Migration non destructive impossible : " + region.name, error);
      }
    }
  }
  return { migrated, errors };
}

export function registerWaterRegionHooks(resync) {
  const onRegion = (region) => {
    if (region?.parent?.id === globalThis.canvas?.scene?.id) {
      void Promise.resolve(resync(region.parent)).catch((error) =>
        console.warn(MODULE_ID + " | Resynchronisation Region impossible", error));
    }
  };
  Hooks.on("createRegion", onRegion);
  Hooks.on("updateRegion", onRegion);
  Hooks.on("deleteRegion", onRegion);
}

export function selectedWaterRegionDocuments() {
  return (globalThis.canvas?.regions?.controlled ?? [])
    .map((placeable) => placeable?.document)
    .filter(Boolean);
}

export async function configureSelectedWaterRegions() {
  if (!game.user?.isGM) return ui.notifications.warn(t("OnlyGM", "Outil réservé au MJ."));
  const regions = selectedWaterRegionDocuments();
  if (!regions.length) return ui.notifications.warn(t("SelectRegion", "Sélectionnez une Region sur la couche Regions."));
  const first = getWaterRegionData(regions[0]);
  const visibilityDepth = first.visibilityDepth;
  const units = foundry.utils.escapeHTML(globalThis.canvas?.scene?.grid?.units ?? "");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("DialogTitle", "PF1 Waters — Corps d'eau") },
    content: '<div class="standard-form">' +
      '<p>' + t("DialogHint", "Élévations dans les unités de grille de cette scène.") + '</p>' +
      '<div class="form-group"><label>' + t("Surface", "Surface") + '</label>' +
      '<div class="form-fields"><input name="surface" type="number" step="any" value="' +
      first.surface + '"><span class="units">' + units + '</span></div></div>' +
      '<div class="form-group"><label>' + t("Depth", "Profondeur") + '</label>' +
      '<div class="form-fields"><input name="depth" type="number" step="any" min="0" value="' +
      (first.depth ?? "") + '" placeholder="' + t("NoBottom", "Fond illimité") +
      '"><span class="units">' + units + '</span></div></div>' +
      '<div class="form-group"><label>' + t("RegionVisibilityDepth", "Profondeur de visibilité sous la surface") +
      '</label><div class="form-fields"><input name="visibilityDepth" type="number" min="0" step="any" value="' +
      visibilityDepth + '"><span class="units">' + units + '</span></div></div><p class="hint">' +
      t("RegionVisibilityDepthHint", "Seuil appliqué au sommet des créatures immergées. Leurs images restent sous la tuile transparente.") +
      '</p>' +
      '<div class="form-group"><label>' +
      t("RingPng", "Image PNG des remous (facultatif)") +
      '</label><div class="form-fields"><file-picker type="image" name="ringPng" value="' +
      foundry.utils.escapeHTML(first.ringPng) +
      '"></file-picker></div><p class="hint">' +
      t("RingPngHint", "Choisir un PNG transparent depuis les ressources Foundry ; laisser vide pour aucun effet.") +
      '</p></div></div>',
    ok: {
      label: t("Confirm", "Définir comme corps d'eau"),
      icon: "fa-solid fa-water",
      callback: (_event, button) => {
        const surfaceRaw = button.form.elements.surface.value;
        const depthRaw = String(button.form.elements.depth.value ?? "").trim();
        const ringPng = String(button.form.elements.ringPng?.value ?? "").trim();
        const visibilityRaw = String(button.form.elements.visibilityDepth?.value ?? "").trim();
        const visibilityDepth = visibilityRaw === "" ? NaN : Number(visibilityRaw);
        if (String(surfaceRaw).trim() === "") throw new Error(t("InvalidSurface", "Surface requise."));
        const surface = Number(surfaceRaw);
        const depth = depthRaw === "" ? null : Number(depthRaw);
        if (!Number.isFinite(surface)) throw new Error(t("InvalidSurface", "Surface invalide."));
        if (depth !== null && (!Number.isFinite(depth) || depth < 0)) {
          throw new Error(t("InvalidDepth", "La profondeur doit être positive ou nulle."));
        }
        if (!Number.isFinite(visibilityDepth) || visibilityDepth < 0) {
          throw new Error(t("InvalidVisibilityDepth", "La profondeur visible doit être positive ou nulle."));
        }
        if (ringPng && !/\.png(?:[?#].*)?$/i.test(ringPng)) {
          throw new Error(t("InvalidRingPng", "Choisissez un fichier PNG ou laissez ce champ vide."));
        }
        return { surface, depth, ringPng, visibilityDepth };
      }
    },
    rejectClose: false,
    modal: true
  });
  if (result === null || result === undefined) return;
  for (const region of regions) {
    await region.setFlag(MODULE_ID, WATER_REGION_FLAG, {
      enabled: true, surface: result.surface, depth: result.depth,
      ringPng: result.ringPng ?? "", visibilityDepth:
        Number.isFinite(result.visibilityDepth) ? result.visibilityDepth : visibilityDepth
    });
  }
  ui.notifications.info(regions.length + " " + t("Configured", "corps d'eau configuré(s)."));
}

export async function clearSelectedWaterRegions() {
  if (!game.user?.isGM) return ui.notifications.warn(t("OnlyGM", "Outil réservé au MJ."));
  const regions = selectedWaterRegionDocuments();
  if (!regions.length) return ui.notifications.warn(t("SelectRegion", "Sélectionnez une Region."));
  for (const region of regions) {
    // Do not unset canonical flags: old enabled flags must not be reactivated.
    await region.setFlag(MODULE_ID, WATER_REGION_FLAG, {
      ...getWaterRegionData(region), enabled: false
    });
  }
  ui.notifications.info(regions.length + " " + t("Cleared", "corps d'eau désactivé(s)."));
}

export function registerWaterRegionSceneControls(controls) {
  const regionControls = controls?.regions;
  if (!regionControls?.tools) return;
  const start = Object.keys(regionControls.tools).length;
  regionControls.tools.pf1WatersConfigure = {
    name: "pf1WatersConfigure", title: t("ToolConfigure", "PF1 Waters — Corps d'eau"),
    icon: "fa-solid fa-water", order: start, button: true,
    visible: Boolean(game.user?.isGM),
    onChange: () => void configureSelectedWaterRegions()
  };
  regionControls.tools.pf1WatersClear = {
    name: "pf1WatersClear", title: t("ToolClear", "PF1 Waters — Retirer la propriété eau"),
    icon: "fa-solid fa-ban", order: start + 1, button: true,
    visible: Boolean(game.user?.isGM),
    onChange: () => void clearSelectedWaterRegions()
  };
}
