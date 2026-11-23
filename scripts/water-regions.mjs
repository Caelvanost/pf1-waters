import {
  MODULE_ID, WATER_REGION_FLAG, finite, t
} from "./constants.mjs";
import { ensureNativeWaterDarknessBehavior } from "./water-native-darkness.mjs";
import {
  getSceneWaterBodies, getSceneWaterBody, getRegionWaterBodyId,
  configureSceneWaterBodies
} from "./water-bodies.mjs";

function readRegionFlag(region, scope) {
  try { return region?.getFlag?.(scope, WATER_REGION_FLAG); }
  catch (_) { return undefined; }
}

/**
 * Game-friendly default underwater sight limits:
 * 36 m for metric Scenes; 120 ft for Scenes measured in feet.
 * These are deliberately rounded alternatives, not an exact unit conversion.
 */
export function getDefaultWaterVisibilityDepth(scene) {
  const unit = String(scene?.grid?.units ?? "m").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (["ft", "ft.", "foot", "feet", "pied", "pieds", "pi"].includes(unit)) {
    return 120;
  }
  if (["km", "kilometre", "kilometres"].includes(unit)) return 0.036;
  if (["cm", "centimetre", "centimetres"].includes(unit)) return 3600;
  if (["mm", "millimetre", "millimetres"].includes(unit)) return 36000;
  if (["mi", "mile", "miles"].includes(unit)) return 36 / 1609.344;
  return 36;
}

function parseRegionFlag(raw, scene) {
  // v1.4.20+: only a Region registered to a scene water body is water.
  const body=getSceneWaterBody(scene,raw?.bodyId);
  const surface=body?.surface??0;
  const depthRaw = raw?.depth;
  const parsedDepth = depthRaw === "" || depthRaw === null || depthRaw === undefined
    ? null : Number(depthRaw);
  // Independent natural-light scale. Existing water Regions fall back to sight depth.
  const visibilityDepth = typeof raw?.visibilityDepth === "number" &&
    Number.isFinite(raw.visibilityDepth) && raw.visibilityDepth >= 0
    ? raw.visibilityDepth : getDefaultWaterVisibilityDepth(scene);
  const sunlightHalfDepth = typeof raw?.sunlightHalfDepth === "number" &&
    Number.isFinite(raw.sunlightHalfDepth) && raw.sunlightHalfDepth >= 0
    ? raw.sunlightHalfDepth : visibilityDepth;
  return {
    enabled: Boolean(raw?.enabled && body),
    surface,
    depth: Number.isFinite(parsedDepth) && parsedDepth >= 0 ? parsedDepth : null,
    // Optional ring image provided by the GM; no default geometric rings.
    ringPng: typeof raw?.ringPng === "string" ? raw.ringPng.trim() : "",
    // Size of the entire ripple image relative to token width and height.
    // Old Regions default to 1.5 without modifying stored data.
    ringScale: typeof raw?.ringScale === "number" &&
      Number.isFinite(raw.ringScale) && raw.ringScale > 0
      ? raw.ringScale : 1.5,
    // A null/missing/invalid value means 36 m (metric) or 120 ft (imperial).
    // Explicit zero is valid; it means no subsurface image visibility.
    visibilityDepth,
    sunlightHalfDepth
  };
}

/**
 * The static banded lighting mode is opt-in; all existing water Regions retain
 * their previous lighting behavior until the GM enables this setting.
 */
export function getWaterDepthBandSettings(region) {
  const raw=readRegionFlag(region,MODULE_ID);
  const value = Number(raw?.darknessBandCount);
  return {
    enabled: raw?.darknessBands === true,
    count: Number.isFinite(value) && value >= 4
      ? Math.min(40, Math.max(4, Math.round(value))) : 24
  };
}

export function getWaterRegionData(region) {
  return parseRegionFlag(readRegionFlag(region,MODULE_ID),region?.parent);
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
    // This query is 2D geometry only. Pick an elevation within the Region's
    // own vertical limits instead of always testing at z=0, which would
    // incorrectly reject beach/deep-water Regions with different elevations.
    const limits=region.elevation;
    const bottom=limits && Number.isFinite(limits.bottom)?limits.bottom:null;
    const top=limits && Number.isFinite(limits.top)?limits.top:null;
    const probe=bottom!==null&&top!==null ? (bottom+top)/2
      :bottom!==null ? bottom+1
      :top!==null ? top-1
      :finite(limits,0);
    return Boolean(region.testPoint({
      x:point.x,y:point.y,elevation:probe
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

export function registerWaterRegionHooks(resync) {
  const onRegion = (region) => {
    // Generated lighting-only Regions must not retrigger swimming state
    // synchronization dozens of times during band creation.
    if ((region?.getFlag?.(MODULE_ID, "waterDepthLightBand") ??
         region?.flags?.[MODULE_ID]?.waterDepthLightBand)?.sourceId) return;
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

/**
 * Associate the selected Regions with one Scene water body.
 * Each Region retains its own footprint and independent physical bottom.
 * If requested, Foundry Region elevation.bottom supplies that local bottom.
 */
export async function attachSelectedWaterRegionsToBody() {
  if(!game.user?.isGM)return ui.notifications.warn(t("OnlyGM","Outil réservé au MJ."));
  const regions=selectedWaterRegionDocuments();
  if(!regions.length)return ui.notifications.warn("Sélectionnez une ou plusieurs Regions.");
  const scene=globalThis.canvas?.scene;
  const bodies=getSceneWaterBodies(scene);
  if(!bodies.length)return ui.notifications.warn("Créez d’abord un corps d’eau de la scène.");
  const first=regions[0],data=getWaterRegionData(first);
  const selectedId=getRegionWaterBodyId(first);
  const esc=value=>foundry.utils.escapeHTML(String(value??""));
  const options=bodies.map(body=>'<option value="'+esc(body.id)+'"'+
    (body.id===selectedId?' selected':'')+'>'+esc(body.name)+
    ' — surface '+esc(body.surface)+'</option>').join("");
  const result=await foundry.applications.api.DialogV2.prompt({
    classes:["pf1-waters-region-dialog"],
    window:{title:"PF1 Waters — Associer des Regions à un corps d’eau"},
    position:{width:520,height:"auto"},
    content:'<div class="standard-form pf1-waters-region-fields">'+
      '<p>'+regions.length+' Region(s) sélectionnée(s). Chaque Region conserve sa géométrie et son fond local.</p>'+
      '<div class="form-group"><label>Corps d’eau</label>'+
      '<div class="form-fields"><select name="bodyId">'+options+'</select></div></div>'+
      '<div class="form-group"><label>Profondeur locale (si aucune élévation inférieure utilisable)</label>'+
      '<div class="form-fields"><input name="depth" type="number" min="0" step="any" value="'+
      esc(data.depth??"")+'" placeholder="Fond illimité"><span class="units">'+
      esc(scene.grid?.units??"")+'</span></div></div>'+
      '<div class="form-group"><label>Utiliser l’élévation inférieure de chaque Region comme fond</label>'+
      '<div class="form-fields"><input name="useRegionBottom" type="checkbox" checked></div></div>'+
      '<p class="hint">Si une Region possède une limite d’élévation inférieure, elle détermine son fond. Sinon, la profondeur saisie est utilisée. La surface reste commune au corps d’eau.</p>'+
      '</div>',
    ok:{
      label:"Associer les Regions",icon:"fa-solid fa-water",
      callback:(_event,button)=>{
        const depthText=String(button.form.elements.depth?.value??"").trim();
        const depth=depthText===""?null:Number(depthText);
        if(depth!==null&&(!Number.isFinite(depth)||depth<0)){
          throw new Error("La profondeur doit être positive ou nulle.");
        }
        return {
          bodyId:String(button.form.elements.bodyId.value),
          depth,useRegionBottom:Boolean(button.form.elements.useRegionBottom?.checked)
        };
      }
    },rejectClose:false,modal:true
  });
  if(!result)return;
  const body=getSceneWaterBody(scene,result.bodyId);
  if(!body)return ui.notifications.warn("Corps d’eau introuvable.");
  for(const region of regions){
    const current=getWaterRegionData(region);
    const bounds=region.elevation?.bottom;
    const depth=result.useRegionBottom&&Number.isFinite(bounds)
      ?Math.max(0,body.surface-bounds):result.depth;
    const bands=getWaterDepthBandSettings(region);
    await region.setFlag(MODULE_ID,WATER_REGION_FLAG,{
      ...current,enabled:true,bodyId:body.id,surface:body.surface,depth,
      darknessBands:bands.enabled,darknessBandCount:bands.count
    });
    await ensureNativeWaterDarknessBehavior(region);
  }
  ui.notifications.info(regions.length+" Region(s) associée(s) à « "+body.name+" ».");
}

/** Keep a Region's local depth, but remove its logical group association. */
export async function detachSelectedWaterRegionsFromBody() {
  if(!game.user?.isGM)return ui.notifications.warn(t("OnlyGM","Outil réservé au MJ."));
  const regions=selectedWaterRegionDocuments();
  if(!regions.length)return ui.notifications.warn("Sélectionnez une ou plusieurs Regions.");
  let changed=0;
  for(const region of regions){
    if(!getRegionWaterBodyId(region))continue;
    const current=getWaterRegionData(region),bands=getWaterDepthBandSettings(region);
    await region.setFlag(MODULE_ID,WATER_REGION_FLAG,{
      ...current,bodyId:null,enabled:false,
      darknessBands:bands.enabled,darknessBandCount:bands.count
    });
    changed++;
  }
  ui.notifications.info(changed+" Region(s) dissociée(s) ; elles ne sont plus considérées comme de l’eau.");
}

export async function configureSelectedWaterRegions() {
  if (!game.user?.isGM) return ui.notifications.warn(t("OnlyGM", "Outil réservé au MJ."));
  const regions = selectedWaterRegionDocuments();
  if (!regions.length) return ui.notifications.warn(t("SelectRegion", "Sélectionnez une Region sur la couche Regions."));
  if(regions.some(region=>!getRegionWaterBodyId(region)||
    !getSceneWaterBody(region.parent,getRegionWaterBodyId(region)))) {
    return ui.notifications.warn("Associez d’abord toutes les Regions sélectionnées à un corps d’eau de la scène.");
  }
  const first = getWaterRegionData(regions[0]);
  const lightingBands = getWaterDepthBandSettings(regions[0]);
  const visibilityDepth = first.visibilityDepth;
  const units = foundry.utils.escapeHTML(globalThis.canvas?.scene?.grid?.units ?? "");
  const result = await foundry.applications.api.DialogV2.prompt({
    classes: ["pf1-waters-region-dialog"],
    // Foundry V13: keep a comfortable dialog width while CSS constrains
    // the window and scrollable content to the available viewport height.
    position: { width: 520, height: "auto" },
    window: { title: t("DialogTitle", "PF1 Waters — Corps d'eau") },
    content: '<div class="standard-form pf1-waters-region-fields">' +
      '<p>La surface est définie par le corps d’eau de la scène ; cette fenêtre configure uniquement la Region.</p>' +
      '<div class="form-group"><label>Surface commune (lecture seule)</label><div class="form-fields">' +
      '<input type="number" value="' + first.surface + '" disabled><span class="units">' + units +
      '</span></div></div>' +
      '<div class="form-group"><label>' + t("Depth", "Profondeur") + '</label>' +
      '<div class="form-fields"><input name="depth" type="number" step="any" min="0" value="' +
      (first.depth ?? "") + '" placeholder="' + t("NoBottom", "Fond illimité") +
      '"><span class="units">' + units + '</span></div></div>' +
      '<div class="form-group"><label>' + t("RegionVisibilityDepth", "Profondeur de visibilité sous la surface") +
      '</label><div class="form-fields"><input name="visibilityDepth" type="number" min="0" step="any" value="' +
      visibilityDepth + '"><span class="units">' + units + '</span></div></div><p class="hint">' +
      t("RegionVisibilityDepthHint", "Seuil appliqué au sommet des créatures immergées. Leurs images restent sous la tuile transparente.") +
      '</p>' +
      '<div class="form-group"><label>Profondeur pour 50 % de lumière naturelle</label>' +
      '<div class="form-fields"><input name="sunlightHalfDepth" type="number" min="0" step="any" value="' +
      first.sunlightHalfDepth + '"><span class="units">' + units + '</span></div></div>' +
      '<p class="hint">50 % de lumière à cette profondeur, 25 % au double, 5 % à cinq fois et extinction à vingt fois. Indépendant de la visibilité sous-marine.</p>' +
      '<div class="form-group"><label>Obscurité native par tranches d’élévation</label>' +
      '<div class="form-fields"><input name="darknessBands" type="checkbox" ' +
      (lightingBands.enabled ? 'checked ' : '') + '></div></div>' +
      '<p class="hint">Crée des Regions d’éclairage auxiliaires, chacune avec une élévation limitée et « Remplacer l’obscurité ». À utiliser si l’obscurité dynamique ne fonctionne pas. Les Regions d’eau physiques restent inchangées.</p>' +
      '<div class="form-group"><label>Nombre de tranches (4 à 40)</label>' +
      '<div class="form-fields"><input name="darknessBandCount" type="number" step="1" min="4" max="40" value="' +
      lightingBands.count + '"></div></div>' +
      '<div class="form-group"><label>' +
      t("RingPng", "Image PNG des remous (facultatif)") +
      '</label><div class="form-fields"><file-picker type="image" name="ringPng" value="' +
      foundry.utils.escapeHTML(first.ringPng) +
      '"></file-picker></div><p class="hint">' +
      t("RingPngHint", "Choisir un PNG transparent depuis les ressources Foundry ; laisser vide pour aucun effet.") +
      '</p></div><div class="form-group"><label>' +
      t("RingScale", "Ratio de taille des remous") +
      '</label><div class="form-fields"><input name="ringScale" type="number" min="0.01" step="0.1" value="' +
      first.ringScale + '"></div></div><p class="hint">' +
      t("RingScaleHint", "Taille de l’image par rapport au token (1,5 par défaut) : un token 1×1 aura des remous de 1,5×1,5 case, centrés sous lui.") +
      '</p></div>',
    ok: {
      label: t("Confirm", "Définir comme corps d'eau"),
      icon: "fa-solid fa-water",
      callback: (_event, button) => {
         const depthRaw = String(button.form.elements.depth.value ?? "").trim();
        const ringPng = String(button.form.elements.ringPng?.value ?? "").trim();
        const ringScaleRaw = String(button.form.elements.ringScale?.value ?? "").trim();
        const ringScale = ringScaleRaw === "" ? NaN : Number(ringScaleRaw);
        const visibilityRaw = String(button.form.elements.visibilityDepth?.value ?? "").trim();
        const visibilityDepth = visibilityRaw === "" ? NaN : Number(visibilityRaw);
        const sunlightRaw = String(button.form.elements.sunlightHalfDepth?.value ?? "").trim();
        const sunlightHalfDepth = sunlightRaw === "" ? NaN : Number(sunlightRaw);
        const darknessBands = Boolean(button.form.elements.darknessBands?.checked);
        const darknessBandCount = Number(button.form.elements.darknessBandCount?.value);
        const depth = depthRaw === "" ? null : Number(depthRaw);
        if (depth !== null && (!Number.isFinite(depth) || depth < 0)) {
          throw new Error(t("InvalidDepth", "La profondeur doit être positive ou nulle."));
        }
        if (!Number.isFinite(visibilityDepth) || visibilityDepth < 0) {
          throw new Error(t("InvalidVisibilityDepth", "La profondeur visible doit être positive ou nulle."));
        }
        if (!Number.isFinite(sunlightHalfDepth) || sunlightHalfDepth < 0) {
          throw new Error("La profondeur pour 50 % de lumière naturelle doit être positive ou nulle.");
        }
        if (!Number.isInteger(darknessBandCount) ||
            darknessBandCount < 4 || darknessBandCount > 40) {
          throw new Error("Le nombre de tranches d’obscurité doit être compris entre 4 et 40.");
        }
        if (!Number.isFinite(ringScale) || ringScale <= 0) {
          throw new Error(t("InvalidRingScale", "Le ratio des remous doit être strictement positif."));
        }
        if (ringPng && !/\.png(?:[?#].*)?$/i.test(ringPng)) {
          throw new Error(t("InvalidRingPng", "Choisissez un fichier PNG ou laissez ce champ vide."));
        }
        return {
          depth, ringPng, ringScale, visibilityDepth, sunlightHalfDepth,
          darknessBands, darknessBandCount
        };
      }
    },
    rejectClose: false,
    // FilePicker opens a separate ApplicationV2 window. A modal DialogV2
    // traps focus and blocks clicking that window even when it is on top.
    // Keep this region editor non-modal so Foundry's browser is interactive.
    modal: false
  });
  if (result === null || result === undefined) return;
  for (const region of regions) {
    const currentBodyId=getRegionWaterBodyId(region);
    await region.setFlag(MODULE_ID, WATER_REGION_FLAG, {
      enabled:true,bodyId:currentBodyId,depth:result.depth,
      ringPng: result.ringPng ?? "",
      ringScale: Number.isFinite(result.ringScale) && result.ringScale > 0
        ? result.ringScale : first.ringScale,
      visibilityDepth:
        Number.isFinite(result.visibilityDepth) ? result.visibilityDepth : visibilityDepth,
      sunlightHalfDepth: result.sunlightHalfDepth,
      darknessBands: result.darknessBands,
      darknessBandCount: result.darknessBandCount
    });
    try { await ensureNativeWaterDarknessBehavior(region); }
    catch(e) { console.warn(MODULE_ID+" | Region sans comportement d'obscurité natif",e); }
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
      ...getWaterRegionData(region),
      bodyId:null,
      darknessBands: getWaterDepthBandSettings(region).enabled,
      darknessBandCount: getWaterDepthBandSettings(region).count,
      enabled: false
    });
  }
  ui.notifications.info(regions.length + " " + t("Cleared", "corps d'eau désactivé(s)."));
}

export function registerWaterRegionSceneControls(controls) {
  const regionControls = controls?.regions;
  if (!regionControls?.tools) return;
  const start = Object.keys(regionControls.tools).length;
  regionControls.tools.pf1WatersBodies = {
    name:"pf1WatersBodies",title:"PF1 Waters — Corps d’eau de la scène",
    icon:"fa-solid fa-list",order:start,button:true,
    visible:Boolean(game.user?.isGM),
    onChange:()=>void configureSceneWaterBodies()
  };
  regionControls.tools.pf1WatersAttachRegion = {
    name:"pf1WatersAttachRegion",title:"PF1 Waters — Ajouter des Regions à un corps d’eau",
    icon:"fa-solid fa-link",order:start+1,button:true,
    visible:Boolean(game.user?.isGM),
    onChange:()=>void attachSelectedWaterRegionsToBody()
  };
  regionControls.tools.pf1WatersDetachRegion = {
    name:"pf1WatersDetachRegion",title:"PF1 Waters — Dissocier les Regions d’un corps d’eau",
    icon:"fa-solid fa-unlink",order:start+2,button:true,
    visible:Boolean(game.user?.isGM),
    onChange:()=>void detachSelectedWaterRegionsFromBody()
  };
  regionControls.tools.pf1WatersConfigure = {
    name: "pf1WatersConfigure", title: t("ToolConfigure", "PF1 Waters — Corps d'eau"),
    icon: "fa-solid fa-water", order: start+3, button: true,
    visible: Boolean(game.user?.isGM),
    onChange: () => void configureSelectedWaterRegions()
  };
  regionControls.tools.pf1WatersClear = {
    name: "pf1WatersClear", title: t("ToolClear", "PF1 Waters — Retirer la propriété eau"),
    icon: "fa-solid fa-ban", order: start + 4, button: true,
    visible: Boolean(game.user?.isGM),
    onChange: () => void clearSelectedWaterRegions()
  };
}
