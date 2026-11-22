/**
 * A Tile or Drawing is a VISUAL surface for an existing water Region.
 * It never defines water volume, swimming, immersion, or projectile physics.
 */
import { MODULE_ID, finite, isPrimaryGM, t } from "./constants.mjs";
import { getWaterRegionData } from "./water-regions.mjs";
const FLAG = "waterSurface";

function values(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  return typeof collection.values === "function" ? [...collection.values()] : [...collection];
}
function unwrap(value) { return value?.document ?? value; }
export function isWaterSurfaceDocument(value) {
  const doc = unwrap(value);
  return doc?.documentName === "Tile" || doc?.documentName === "Drawing";
}
export function getWaterSurfaceData(value) {
  const doc = unwrap(value);
  const raw = isWaterSurfaceDocument(doc) ? doc?.getFlag?.(MODULE_ID, FLAG) : null;
  return {
    enabled: Boolean(raw?.enabled),
    regionId: typeof raw?.regionId === "string" ? raw.regionId : null,
    syncElevation: raw?.syncElevation !== false,
    // Visual range only. The Region is solely responsible for water physics.
    visibilityDepth: Math.max(0, finite(raw?.visibilityDepth,
      Math.max(0, finite(doc?.parent?.grid?.distance, 1.5)) * 2)),
    // Surface artwork must not behave like a fading roof. This preserves
    // the native lighting / vision / fog rules for the actual Tile.
    keepVisible: raw?.keepVisible !== false,
    previousOcclusionMode: Number.isFinite(raw?.previousOcclusionMode)
      ? raw.previousOcclusionMode : null
  };
}
export function resolveWaterSurfaceRegion(value) {
  const doc = unwrap(value);
  const { enabled, regionId } = getWaterSurfaceData(doc);
  if (!enabled || !regionId || !doc?.parent) return null;
  const region = values(doc.parent.regions).find((r) => r.id === regionId);
  return region && getWaterRegionData(region).enabled ? region : null;
}
export function getWaterSurfacesForRegion(region) {
  if (!region?.parent) return [];
  return [...values(region.parent.tiles), ...values(region.parent.drawings)].filter((doc) =>
    getWaterSurfaceData(doc).enabled && resolveWaterSurfaceRegion(doc)?.id === region.id
  );
}
/**
 * A water-surface Tile is environmental art, not a roof.
 * Setting Foundry v13 native occlusion.mode=NONE prevents tokens from
 * fading the surface when they move above/below its elevation. Foundry's
 * normal lighting, vision, fog, hidden state, and Levels still apply.
 *
 * GM-only document changes; the original non-NONE mode is saved and
 * restored upon unlink/opt-out. No client-local bypass of vision masks.
 */
export async function syncWaterSurfaceVisibility(value) {
  const doc = unwrap(value);
  if (!isPrimaryGM() || doc?.documentName !== "Tile" ||
      typeof doc.update !== "function" || typeof doc.setFlag !== "function") return false;
  const data = getWaterSurfaceData(doc);
  const mode = Number(doc.occlusion?.mode);
  if (!Number.isFinite(mode)) return false;
  const NONE = globalThis.CONST?.OCCLUSION_MODES?.NONE ?? 0;
  const active = data.enabled && data.keepVisible &&
    Boolean(resolveWaterSurfaceRegion(doc));
  const original = data.previousOcclusionMode;

  if (active) {
    if (mode === NONE) return false;
    // Record the current native mode only once, before changing it.
    if (original === null) {
      await doc.setFlag(MODULE_ID, FLAG, {
        ...data, previousOcclusionMode: mode
      });
    }
    await doc.update({ "occlusion.mode": NONE });
    return true;
  }

  // An unlink or opt-out restores the original mode if the tile still
  // uses our NONE setting. Do not undo a later manual GM change.
  if (original === null) return false;
  if (mode === NONE) await doc.update({ "occlusion.mode": original });
  await doc.setFlag(MODULE_ID, FLAG, {
    ...data, previousOcclusionMode: null
  });
  return true;
}

export async function syncSceneWaterSurfaceVisibilities(scene = globalThis.canvas?.scene) {
  if (!scene || !isPrimaryGM()) return { changed: 0, failed: 0 };
  let changed = 0, failed = 0;
  for (const doc of values(scene.tiles)) {
    if (!getWaterSurfaceData(doc).enabled &&
        getWaterSurfaceData(doc).previousOcclusionMode === null) continue;
    try { if (await syncWaterSurfaceVisibility(doc)) changed++; }
    catch (error) {
      failed++;
      console.warn(MODULE_ID + " | Occlusion de surface impossible", doc?.id, error);
    }
  }
  return { changed, failed };
}

export async function syncWaterSurfaceElevation(value) {
  const doc = unwrap(value);
  if (!isPrimaryGM() || !getWaterSurfaceData(doc).syncElevation) return false;
  const region = resolveWaterSurfaceRegion(doc);
  if (!region || typeof doc.update !== "function") return false;
  const expected = getWaterRegionData(region).surface;
  if (Math.abs(finite(doc.elevation, expected) - expected) <= 1e-6) return false;
  await doc.update({ elevation: expected });
  return true;
}
export async function syncSceneWaterSurfaceElevations(scene = globalThis.canvas?.scene) {
  if (!scene || !isPrimaryGM()) return { aligned: 0, failed: 0 };
  let aligned = 0, failed = 0;
  for (const doc of [...values(scene.tiles), ...values(scene.drawings)]) {
    if (!getWaterSurfaceData(doc).enabled) continue;
    try { if (await syncWaterSurfaceElevation(doc)) aligned++; }
    catch (error) {
      failed++;
      console.warn(MODULE_ID + " | Alignement de surface impossible", doc?.id, error);
    }
  }
  return { aligned, failed };
}
function selected(type) {
  const layer = type === "Tile" ? globalThis.canvas?.tiles : globalThis.canvas?.drawings;
  return (layer?.controlled ?? []).map(unwrap).filter((d) => d?.documentName === type);
}
export async function configureSelectedWaterSurfaces(type) {
  if (!game.user?.isGM) return ui.notifications.warn(t("OnlyGM", "Outil réservé au MJ."));
  const chosen = selected(type);
  if (!chosen.length) return ui.notifications.warn(t("SelectSurface", "Sélectionnez une tuile ou un dessin."));
  const regions = values(globalThis.canvas?.scene?.regions).filter((r) => getWaterRegionData(r).enabled);
  if (!regions.length) return ui.notifications.warn(t("NoRegions", "Définissez d'abord une Region aquatique."));
  const first = getWaterSurfaceData(chosen[0]);
  const selectedId = regions.some((r) => r.id === first.regionId) ? first.regionId : regions[0].id;
  const esc = (value) => foundry.utils.escapeHTML(String(value ?? ""));
  const options = regions.map((r) => '<option value="' + esc(r.id) + '"' +
    (r.id === selectedId ? " selected" : "") + ">" +
    esc(r.name || r.id) + " — " + esc(getWaterRegionData(r).surface) + "</option>").join("");
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: type === "Tile" ?
      t("TileLinkTitle", "PF1 Waters — Surface d’eau (tuile)") :
      t("DrawingLinkTitle", "PF1 Waters — Surface d’eau (dessin)") },
    content: '<div class="standard-form"><p>' +
      t("LinkHint", "Cet objet n’est que la surface visuelle ; la Region détermine le volume et la profondeur.") +
      '</p><div class="form-group"><label>' + t("LinkedRegion", "Region aquatique") +
      '</label><div class="form-fields"><select name="regionId">' + options +
      '</select></div></div><div class="form-group"><label>' +
      t("AlignSurface", "Aligner l’élévation sur la Region") +
      '</label><div class="form-fields"><input name="syncElevation" type="checkbox"' +
      (first.syncElevation ? " checked" : "") +
      '></div></div><div class="form-group"><label>' +
      t("VisibilityDepth", "Profondeur maximale de visibilité sous l’eau") +
      '</label><div class="form-fields"><input name="visibilityDepth" type="number" min="0" step="any" value="' +
      esc(first.visibilityDepth) + '"></div></div><p class="hint">' +
      t("VisibilityDepthHint", "En unités de scène. Le sommet du token disparaît lorsqu’il atteint cette profondeur.") +
      '</p><div class="form-group"><label>' +
      t("KeepWaterVisible", "Ne pas masquer la surface comme une toiture") +
      '</label><div class="form-fields"><input name="keepVisible" type="checkbox"' +
      (first.keepVisible ? " checked" : "") +
      '></div></div><p class="hint">' +
      t("KeepWaterVisibleHint", "Une tuile de surface reste visible depuis le dessus, selon la vision normale de Foundry. Son ancien mode d’occlusion sera restauré si elle est dissociée.") +
      '</p></div>',
    ok: {
      label: t("LinkConfirm", "Lier à la surface d’eau"),
      icon: "fa-solid fa-water",
      callback: (_event, button) => ({
        regionId: String(button.form.elements.regionId.value),
        syncElevation: Boolean(button.form.elements.syncElevation.checked),
        visibilityDepth: Number(button.form.elements.visibilityDepth.value),
        keepVisible: Boolean(button.form.elements.keepVisible?.checked)
      })
    },
    rejectClose: false, modal: true
  });
  if (!result) return;
  if (!regions.some((r) => r.id === result.regionId)) {
    return ui.notifications.warn(t("NoRegions", "Region aquatique introuvable."));
  }
  if (!Number.isFinite(result.visibilityDepth) || result.visibilityDepth < 0) {
    return ui.notifications.warn(t("InvalidVisibilityDepth",
      "La profondeur de visibilité doit être positive ou nulle."));
  }
  for (const doc of chosen) {
    await doc.setFlag(MODULE_ID, FLAG, {
      enabled: true, regionId: result.regionId, syncElevation: result.syncElevation,
      visibilityDepth: result.visibilityDepth, keepVisible: result.keepVisible,
      previousOcclusionMode: getWaterSurfaceData(doc).previousOcclusionMode
    });
    if (result.syncElevation) await syncWaterSurfaceElevation(doc);
    await syncWaterSurfaceVisibility(doc);
  }
  ui.notifications.info(chosen.length + " " + t("Linked", "surface(s) visuelle(s) associée(s)."));
}
export async function clearSelectedWaterSurfaces(type) {
  if (!game.user?.isGM) return ui.notifications.warn(t("OnlyGM", "Outil réservé au MJ."));
  const chosen = selected(type);
  if (!chosen.length) return ui.notifications.warn(t("SelectSurface", "Sélectionnez une tuile ou un dessin."));
  for (const doc of chosen) {
    await doc.setFlag(MODULE_ID, FLAG, { ...getWaterSurfaceData(doc), enabled: false });
    await syncWaterSurfaceVisibility(doc);
  }
  ui.notifications.info(chosen.length + " " + t("Unlinked", "surface(s) visuelle(s) dissociée(s)."));
}
export function registerWaterSurfaceSceneControls(controls) {
  for (const [layer, type, configure, clear] of [
    ["tiles", "Tile", "TileLinkTool", "TileUnlinkTool"],
    ["drawings", "Drawing", "DrawingLinkTool", "DrawingUnlinkTool"]
  ]) {
    const group = controls?.[layer];
    if (!group?.tools) continue;
    const order = Object.keys(group.tools).length;
    group.tools["pf1Waters" + configure] = {
      name: "pf1Waters" + configure, title: t(configure, "Lier à la surface d’eau"),
      icon: "fa-solid fa-water", order, button: true, visible: Boolean(game.user?.isGM),
      onChange: () => void configureSelectedWaterSurfaces(type)
    };
    group.tools["pf1Waters" + clear] = {
      name: "pf1Waters" + clear, title: t(clear, "Dissocier la surface d’eau"),
      icon: "fa-solid fa-unlink", order: order + 1, button: true,
      visible: Boolean(game.user?.isGM),
      onChange: () => void clearSelectedWaterSurfaces(type)
    };
  }
}
export function registerWaterSurfaceHooks() {
  Hooks.on("updateRegion", (region) => {
    if (region?.parent?.id === globalThis.canvas?.scene?.id) {
      void syncSceneWaterSurfaceElevations(region.parent);
      void syncSceneWaterSurfaceVisibilities(region.parent);
    }
  });
  for (const event of ["createTile", "updateTile", "createDrawing", "updateDrawing"]) {
    Hooks.on(event, (doc, changes) => {
      if (!isPrimaryGM() || !doc?.parent) return;
      if (event.startsWith("update") && !("elevation" in (changes ?? {}) || "flags" in (changes ?? {}))) return;
      void syncWaterSurfaceElevation(doc).catch((error) =>
        console.warn(MODULE_ID + " | Surface visuelle non synchronisée", error));
      void syncWaterSurfaceVisibility(doc).catch((error) =>
        console.warn(MODULE_ID + " | Occlusion de surface non synchronisée", error));
    });
  }
  Hooks.on("canvasReady", () => {
    void syncSceneWaterSurfaceElevations(globalThis.canvas?.scene);
    void syncSceneWaterSurfaceVisibilities(globalThis.canvas?.scene);
  });
}
