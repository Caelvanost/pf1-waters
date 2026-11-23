/**
 * Scene-local water bodies.
 *
 * A body is a logical group: one shared water surface, many independently
 * shaped and independently deep physical water Regions, and many visual
 * Tiles/Drawings. No synthetic parent Region is required.
 *
 * Every physical Region and visual surface must belong to a registered body.
 */
import {
  MODULE_ID, WATER_REGION_FLAG, t
} from "./constants.mjs";

const FLAG = "waterBodies";

/** Distances in the Scene's own grid units, matching the PF1 Waters metric defaults. */
export function getDefaultWaterVisionRange(scene) {
  const unit=String(scene?.grid?.units??"m").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if(["ft","ft.","foot","feet","pied","pieds","pi"].includes(unit))return 120;
  if(["km","kilometre","kilometres"].includes(unit))return .036;
  if(["cm","centimetre","centimetres"].includes(unit))return 3600;
  if(["mm","millimetre","millimetres"].includes(unit))return 36000;
  if(["mi","mile","miles"].includes(unit))return 36/1609.344;
  return 36;
}

/** New bodies have adjustable vision without modifying TokenDocument.sight. */
export function getDefaultWaterVisionSettings(scene) {
  const range=getDefaultWaterVisionRange(scene);
  return {visionEnabled:true,visionRange:range,visionHalfDepth:range/4};
}

export function getSceneWaterBodies(scene=globalThis.canvas?.scene) {
  const raw=scene?.getFlag?.(MODULE_ID,FLAG) ??
    scene?.flags?.[MODULE_ID]?.[FLAG];
  if (!Array.isArray(raw)) return [];
  const seen=new Set();
  const defaults=getDefaultWaterVisionSettings(scene);
  return raw.flatMap(value=>{
    const id=typeof value?.id==="string" ? value.id.trim() : "";
    const name=typeof value?.name==="string" ? value.name.trim() : "";
    const elevation=Number(value?.surface);
    if (!id || !name || !Number.isFinite(elevation) || seen.has(id)) return [];
    seen.add(id);
    const range=Number(value?.visionRange);
    const halfDepth=Number(value?.visionHalfDepth);
    return [{
      id,name,surface:elevation,
      visionEnabled:value?.visionEnabled!==false,
      visionRange:value?.visionRange!==null&&value?.visionRange!==undefined&&
        value?.visionRange!==""&&Number.isFinite(range)&&range>=0
        ?range:defaults.visionRange,
      visionHalfDepth:value?.visionHalfDepth!==null&&value?.visionHalfDepth!==undefined&&
        value?.visionHalfDepth!==""&&Number.isFinite(halfDepth)&&halfDepth>=0
        ?halfDepth:defaults.visionHalfDepth
    }];
  });
}
export function getSceneWaterBody(scene,id) {
  if(typeof id!=="string"||!id.trim())return null;
  return getSceneWaterBodies(scene).find(b=>b.id===id.trim())??null;
}
export function getRegionWaterBodyId(region) {
  const raw=region?.getFlag?.(MODULE_ID,WATER_REGION_FLAG) ??
    region?.flags?.[MODULE_ID]?.[WATER_REGION_FLAG];
  return typeof raw?.bodyId==="string" && raw.bodyId.trim()
    ? raw.bodyId.trim() : null;
}
export function getRegionWaterBody(region) {
  return getSceneWaterBody(region?.parent,getRegionWaterBodyId(region));
}
export function areWaterRegionsInSameBody(first,second) {
  if(!first||!second||first.parent?.id!==second.parent?.id)return false;
  if(first.id===second.id)return true;
  const a=getRegionWaterBody(first);
  return Boolean(a && getRegionWaterBodyId(second)===a.id &&
    getSceneWaterBody(second.parent,a.id));
}

function localEscape(value) {
  return globalThis.foundry?.utils?.escapeHTML?.(String(value??"")) ??
    String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;")
      .replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

export async function saveSceneWaterBody(scene,values) {
  if(!game.user?.isGM||!scene?.setFlag)throw Error("Modification réservée au MJ.");
  const name=String(values?.name??"").trim();
  const surface=values?.surface===""?NaN:Number(values?.surface);
  if(!name)throw Error("Le nom du corps d’eau est obligatoire.");
  if(!Number.isFinite(surface))throw Error("L’élévation de surface est invalide.");
  const bodies=getSceneWaterBodies(scene);
  const previous=bodies.find(body=>body.id===values?.id);
  const defaults=getDefaultWaterVisionSettings(scene);
  const visionEnabled=typeof values?.visionEnabled==="boolean"?
    values.visionEnabled:previous?.visionEnabled??defaults.visionEnabled;
  const visionRange=values?.visionRange===undefined?
    previous?.visionRange??defaults.visionRange:
    values.visionRange===""||values.visionRange===null?NaN:Number(values.visionRange);
  const visionHalfDepth=values?.visionHalfDepth===undefined?
    previous?.visionHalfDepth??defaults.visionHalfDepth:
    values.visionHalfDepth===""||values.visionHalfDepth===null?NaN:Number(values.visionHalfDepth);
  if(!Number.isFinite(visionRange)||visionRange<0){
    throw Error("La distance maximale de vision doit être un nombre positif ou nul.");
  }
  if(!Number.isFinite(visionHalfDepth)||visionHalfDepth<0){
    throw Error("La profondeur de demi-visibilité doit être un nombre positif ou nul.");
  }
  const id=typeof values?.id==="string"&&values.id.trim()?values.id.trim():
    (globalThis.foundry?.utils?.randomID?.(12) ??
      globalThis.crypto?.randomUUID?.() ?? "water-"+Date.now());
  const entry={id,name,surface,visionEnabled,visionRange,visionHalfDepth};
  const index=bodies.findIndex(b=>b.id===id);
  if(index>=0)bodies[index]=entry;
  else bodies.push(entry);
  await scene.setFlag(MODULE_ID,FLAG,bodies);
  return entry;
}
export function getSceneWaterBodyDependents(scene,id) {
  const regions=[...(scene?.regions??[])].filter(region=>
    getRegionWaterBodyId(region)===id);
  const visuals=[...(scene?.tiles??[]),...(scene?.drawings??[])].filter(doc=>{
    const raw=doc?.getFlag?.(MODULE_ID,"waterSurface") ??
      doc?.flags?.[MODULE_ID]?.waterSurface;
    return raw?.bodyId===id;
  });
  return {regions,visuals};
}
export async function deleteSceneWaterBody(scene,id) {
  if(!game.user?.isGM||!scene?.setFlag)throw Error("Modification réservée au MJ.");
  const entry=getSceneWaterBody(scene,id);
  if(!entry)return false;
  const {regions,visuals}=getSceneWaterBodyDependents(scene,id);
  if(regions.length||visuals.length)throw Error(
    "Dissociez d’abord les "+regions.length+" Region(s) et "+
    visuals.length+" tuile(s)/dessin(s) de ce corps d’eau."
  );
  await scene.setFlag(MODULE_ID,FLAG,getSceneWaterBodies(scene).filter(b=>b.id!==id));
  return true;
}

/**
 * Single scene tool: choose Create / Edit / Delete, then a compact form.
 * The UI remains a normal Foundry V13 DialogV2 with no new dependency.
 */
export async function configureSceneWaterBodies() {
  if(!game.user?.isGM)return ui.notifications.warn(t("OnlyGM","Outil réservé au MJ."));
  const scene=globalThis.canvas?.scene;
  if(!scene)return;
  const bodies=getSceneWaterBodies(scene);
  const entries=bodies.map(b=>'<option value="'+localEscape(b.id)+'">'+
    localEscape(b.name)+' — '+localEscape(b.surface)+'</option>').join("");
  const menu=await foundry.applications.api.DialogV2.prompt({
    classes:["pf1-waters-region-dialog"],
    window:{title:"PF1 Waters — Corps d’eau de la scène"},
    content:'<div class="standard-form pf1-waters-region-fields">'+
      '<p>Chaque corps d’eau possède une surface commune. Ses Regions déterminent des contours et des profondeurs locales.</p>'+
      '<div class="form-group"><label>Opération</label><div class="form-fields">'+
      '<select name="action"><option value="create">Créer un corps d’eau</option>'+
      (bodies.length?'<option value="edit">Modifier un corps d’eau</option>'+
      '<option value="delete">Supprimer un corps d’eau</option>':"")+
      '</select></div></div>'+
      (bodies.length?'<div class="form-group"><label>Corps d’eau existant</label>'+
      '<div class="form-fields"><select name="bodyId">'+entries+
      '</select></div></div>':"")+'</div>',
    ok:{
      label:"Continuer",icon:"fa-solid fa-water",
      callback:(_event,button)=>({
        action:String(button.form.elements.action.value),
        bodyId:String(button.form.elements.bodyId?.value??"")
      })
    },rejectClose:false,modal:true
  });
  if(!menu)return;
  const old=menu.action==="create"?null:getSceneWaterBody(scene,menu.bodyId);
  if(menu.action!=="create"&&!old)return ui.notifications.warn("Corps d’eau introuvable.");
  if(menu.action==="delete"){
    try{
      const dependencies=getSceneWaterBodyDependents(scene,old.id);
      if(dependencies.regions.length||dependencies.visuals.length){
        return ui.notifications.warn("Dissociez d’abord les Regions, tuiles et dessins appartenant à ce corps d’eau.");
      }
      const confirmation=await foundry.applications.api.DialogV2.confirm({
        window:{title:"Supprimer le corps d’eau"},
        content:"Supprimer définitivement « "+localEscape(old.name)+" » ?",
        rejectClose:false
      });
      if(confirmation)await deleteSceneWaterBody(scene,old.id);
    }catch(error){ui.notifications.error(error.message);}
    return;
  }
  const values=await foundry.applications.api.DialogV2.prompt({
    classes:["pf1-waters-region-dialog"],
    window:{title:old?"Modifier "+old.name:"Nouveau corps d’eau"},
    content:'<div class="standard-form pf1-waters-region-fields">'+
      '<div class="form-group"><label>Nom</label><div class="form-fields">'+
      '<input name="name" type="text" required value="'+localEscape(old?.name??"")+
      '" placeholder="Baie des Épaves"></div></div>'+
      '<div class="form-group"><label>Élévation commune de la surface</label>'+
      '<div class="form-fields"><input name="surface" type="number" required step="any" value="'+
      localEscape(old?.surface??0)+'"><span class="units">'+
      localEscape(scene.grid?.units??"")+'</span></div></div>'+
      '<div class="form-group"><label>Limiter la vision sous-marine</label>'+
      '<div class="form-fields"><input name="visionEnabled" type="checkbox" '+
      ((old?.visionEnabled??true)?'checked ':'')+'></div></div>'+
      '<div class="form-group"><label>Distance maximale de vision à la surface</label>'+
      '<div class="form-fields"><input name="visionRange" type="number" required min="0" step="any" value="'+
      localEscape(old?.visionRange??getDefaultWaterVisionRange(scene))+'"><span class="units">'+
      localEscape(scene.grid?.units??"")+'</span></div></div>'+
      '<div class="form-group"><label>Demi-profondeur d’atténuation lumineuse</label>'+
      '<div class="form-fields"><input name="visionHalfDepth" type="number" required min="0" step="any" value="'+
      localEscape(old?.visionHalfDepth??getDefaultWaterVisionSettings(scene).visionHalfDepth)+
      '"><span class="units">'+localEscape(scene.grid?.units??"")+'</span></div></div>'+
      '<p class="hint">La distance maximale fixe la transparence physique de l’eau, identique à toutes les profondeurs. La demi-profondeur règle l’assombrissement progressif de la lumière naturelle (50 % à la profondeur indiquée), sans raccourcir le champ de vision. La vision dans le noir et les lumières locales conservent leurs règles natives PF1 et restent limitées par la transparence de l’eau.</p>'+
      '</div>',
    ok:{
      label:old?"Enregistrer":"Créer",icon:"fa-solid fa-water",
      callback:(_event,button)=>({
        name:String(button.form.elements.name.value).trim(),
        surface:button.form.elements.surface.value,
        visionEnabled:Boolean(button.form.elements.visionEnabled?.checked),
        visionRange:button.form.elements.visionRange.value,
        visionHalfDepth:button.form.elements.visionHalfDepth.value,
        id:old?.id
      })
    },rejectClose:false,modal:true
  });
  if(!values)return;
  try{
    const created=await saveSceneWaterBody(scene,values);
    ui.notifications.info("Corps d’eau « "+created.name+" » enregistré.");
  }catch(error){ui.notifications.error(error.message);}
}

/**
 * Foundry V13: give PF1 Waters its own ROOT SceneControl, like Levels.
 *
 * V13 requires a real non-button activeTool even when the palette only
 * contains actions. The neutral overview tool satisfies that requirement;
 * selecting the root icon opens the scene manager immediately, while the
 * explicit action tool allows reopening the manager without switching layers.
 *
 * Keep the Region-layer controls as direct tools for attaching Region shapes;
 * only the registry management needs a scene-wide root entry.
 */
export function registerWaterBodyRootSceneControl(controls) {
  if(!game.user?.isGM || !controls || typeof controls !== "object") return;
  if(controls.pf1Waters) return;

  const orders=Object.values(controls)
    .map(control=>Number(control?.order))
    .filter(Number.isFinite);
  const order=orders.length ? Math.max(...orders)+1 : 100;
  const openManager=()=>void configureSceneWaterBodies();

  controls.pf1Waters={
    name:"pf1Waters",
    title:"PF1 Waters — Corps d’eau",
    icon:"fa-solid fa-water",
    order,
    visible:true,
    activeTool:"overview",
    onChange:(_event,active)=>{
      if(active)openManager();
    },
    tools:{
      overview:{
        name:"overview",
        title:"PF1 Waters — Gestion des corps d’eau",
        icon:"fa-solid fa-water",
        order:0,
        visible:true,
        // A persistent selectable tool is required by V13. The root itself
        // opens the dialog; this tool only retains a valid activeTool.
        onChange:()=>{}
      },
      manageBodies:{
        name:"manageBodies",
        title:"PF1 Waters — Ouvrir la gestion des corps d’eau",
        icon:"fa-solid fa-list",
        order:1,
        button:true,
        visible:true,
        onChange:openManager
      }
    }
  };
}
