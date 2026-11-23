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

export function getSceneWaterBodies(scene=globalThis.canvas?.scene) {
  const raw=scene?.getFlag?.(MODULE_ID,FLAG) ??
    scene?.flags?.[MODULE_ID]?.[FLAG];
  if (!Array.isArray(raw)) return [];
  const seen=new Set();
  return raw.flatMap(value=>{
    const id=typeof value?.id==="string" ? value.id.trim() : "";
    const name=typeof value?.name==="string" ? value.name.trim() : "";
    const elevation=Number(value?.surface);
    if (!id || !name || !Number.isFinite(elevation) || seen.has(id)) return [];
    seen.add(id);
    return [{id,name,surface:elevation}];
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
  const id=typeof values?.id==="string"&&values.id.trim()?values.id.trim():
    (globalThis.foundry?.utils?.randomID?.(12) ??
      globalThis.crypto?.randomUUID?.() ?? "water-"+Date.now());
  const entry={id,name,surface};
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
      '</div>',
    ok:{
      label:old?"Enregistrer":"Créer",icon:"fa-solid fa-water",
      callback:(_event,button)=>({
        name:String(button.form.elements.name.value).trim(),
        surface:button.form.elements.surface.value,
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
