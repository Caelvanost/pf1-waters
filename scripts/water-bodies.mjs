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
import {
  DEFAULT_WATER_CLARITY,WATER_LIGHT_PROFILES,getWaterClarityProfile,
  getWaterClaritySettings,inferLegacyWaterClarity,getAutomaticWaterLightDepths,getWaterLightDepthStep,normalizeWaterLightDepths
} from "./water-optics.mjs";

const FLAG = "waterBodies";

/** Kept for API compatibility. The clarity selector owns both values. */
export function getDefaultWaterVisionRange(scene){
  return getWaterClaritySettings(scene).visionRange;
}
export function getDefaultWaterVisionSettings(scene){
  return {visionEnabled:true,...getWaterClaritySettings(scene)};
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
    const profile=getWaterClarityProfile(value?.waterClarity);
    const settings=profile?getWaterClaritySettings(scene,profile.id):null;
    const range=Number(value?.visionRange);
    const halfDepth=Number(value?.visionHalfDepth);
    // Old records have no clarity ID. Respect their exact numeric range
    // and sunlight curve UNTIL the GM explicitly selects a clarity level.
    const legacyRange=value?.visionRange!==null&&value?.visionRange!==undefined&&
      value?.visionRange!==""&&Number.isFinite(range)&&range>=0
      ?range:defaults.visionRange;
    const legacyHalf=value?.visionHalfDepth!==null&&value?.visionHalfDepth!==undefined&&
      value?.visionHalfDepth!==""&&Number.isFinite(halfDepth)&&halfDepth>=0
      ?halfDepth:defaults.visionHalfDepth;
    return [{
      id,name,surface:elevation,
      waterClarity:profile?.id??null,
      visionEnabled:value?.visionEnabled!==false,
      visionRange:settings?.visionRange??legacyRange,
      visionHalfDepth:settings?.visionHalfDepth??legacyHalf,
      ...(normalizeWaterLightDepths(value.lightDepths)?{lightDepths:normalizeWaterLightDepths(value.lightDepths)}:{})
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
  // Explicit clarity selection is canonical. Numeric overrides are accepted
  // for old API callers but are never requested in the GM dialog.
  const selectedClarity=values?.waterClarity===undefined
    ?(values?.visionRange!==undefined||values?.visionHalfDepth!==undefined
      ?null:(previous?.waterClarity??(previous?null:DEFAULT_WATER_CLARITY)))
    :values.waterClarity;
  const clarity=selectedClarity===null?null:getWaterClarityProfile(selectedClarity);
  if(selectedClarity!==null&&!clarity)throw Error("Clarté de l’eau inconnue.");
  const resolved=clarity?getWaterClaritySettings(scene,clarity.id):null;
  const visionEnabled=typeof values?.visionEnabled==="boolean"
    ?values.visionEnabled:previous?.visionEnabled??defaults.visionEnabled;
  const visionRange=resolved?.visionRange??(values?.visionRange===undefined
    ?previous?.visionRange??defaults.visionRange:
    values.visionRange===""||values.visionRange===null?NaN:Number(values.visionRange));
  const visionHalfDepth=resolved?.visionHalfDepth??(values?.visionHalfDepth===undefined
    ?previous?.visionHalfDepth??defaults.visionHalfDepth:
    values.visionHalfDepth===""||values.visionHalfDepth===null?NaN:Number(values.visionHalfDepth));
  if(!Number.isFinite(visionRange)||visionRange<0)
    throw Error("La distance maximale de vision doit être un nombre positif ou nul.");
  if(!Number.isFinite(visionHalfDepth)||visionHalfDepth<0)
    throw Error("La profondeur de demi-visibilité doit être un nombre positif ou nul.");
  const id=typeof values?.id==="string"&&values.id.trim()?values.id.trim():
    (globalThis.foundry?.utils?.randomID?.(12) ??
      globalThis.crypto?.randomUUID?.() ?? "water-"+Date.now());
  const lightDepths=values?.lightDepths===undefined?previous?.lightDepths??null:values.lightDepths;
  const normalized=normalizeWaterLightDepths(lightDepths);
  if(lightDepths!==null&&!normalized)throw Error("Les quatre profondeurs doivent être positives ou nulles et croissantes.");
  const entry={id,name,surface,waterClarity:clarity?.id??null,
    visionEnabled,visionRange,visionHalfDepth,...(normalized?{lightDepths:normalized}:{})};
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
  const Dialog=foundry.applications.api.DialogV2;
  const menu=await (Dialog.wait??Dialog.prompt).call(Dialog,{
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
    buttons:[{
      action:"continue",label:"Continuer",icon:"fa-solid fa-water",
      callback:(_event,button)=>({
        action:String(button.form.elements.action.value),
        bodyId:String(button.form.elements.bodyId?.value??"")
      })
    },...(bodies.length?[{
      action:"lightDepth",label:"Configurer profondeur de lumière",icon:"fa-solid fa-sun",
      callback:(_event,button)=>({action:"lightDepth",bodyId:String(button.form.elements.bodyId?.value??"")})
    }]:[])],default:"continue",rejectClose:false,modal:true
  });
  if(!menu)return;
  const old=menu.action==="create"?null:getSceneWaterBody(scene,menu.bodyId);
  if(menu.action!=="create"&&!old)return ui.notifications.warn("Corps d’eau introuvable.");
  if(menu.action==="lightDepth")return configureWaterBodyLightDepths(scene,old);
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
      '<div class="form-group"><label>Clarté de l’eau</label>'+
      '<div class="form-fields"><select name="waterClarity">'+
      WATER_LIGHT_PROFILES.map(profile=>
        '<option value="'+profile.id+'"'+
        ((old?.waterClarity??inferLegacyWaterClarity(scene,
          old?.visionRange??getDefaultWaterVisionRange(scene),
          old?.visionHalfDepth??getDefaultWaterVisionSettings(scene).visionHalfDepth))===profile.id
          ?' selected':'')+
        '>'+localEscape(profile.label)+' — '+localEscape(profile.description)+
        '</option>'
      ).join('')+'</select></div></div>'+
      '<p class="hint">Plus l’eau est trouble, plus la distance de visibilité diminue et plus la lumière naturelle s’atténue rapidement avec la profondeur. La vision dans le noir ne contourne pas la limite de transparence de l’eau. Les anciens réglages numériques sont conservés jusqu’à la sélection d’un profil.</p>'+
      '</div>',
    ok:{
      label:old?"Enregistrer":"Créer",icon:"fa-solid fa-water",
      callback:(_event,button)=>({
        name:String(button.form.elements.name.value).trim(),
        surface:button.form.elements.surface.value,
        visionEnabled:true,
        waterClarity:button.form.elements.waterClarity.value,
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

/** Configure the four native darkness thresholds for one water body. */
export async function configureWaterBodyLightDepths(scene,body){
  if(!game.user?.isGM||!body)return;
  const step=getWaterLightDepthStep(scene);
  const auto=getAutomaticWaterLightDepths(scene,body.visionHalfDepth);
  const current=body.lightDepths??auto;
  const units=localEscape(scene.grid?.units??"m");
  const result=await foundry.applications.api.DialogV2.prompt({
    classes:["pf1-waters-region-dialog"],
    window:{title:"Configurer profondeur de lumière — "+body.name},
    content:'<div class="standard-form pf1-waters-region-fields">'+
      '<p>Profondeurs positives sous la surface commune. Les valeurs identiques suppriment les tranches de largeur nulle.</p>'+
      '<div class="form-group"><label>Calcul automatique selon la clarté</label><div class="form-fields">'+
      '<input type="checkbox" name="automatic" '+(!body.lightDepths?'checked':'')+'></div></div>'+
      '<p class="hint">Décochez pour personnaliser les seuils. Les valeurs sont arrondies aux cases de '+localEscape(step)+' '+units+'.</p>'+
      [25,50,75,100].map((level,i)=>'<div class="form-group"><label>Obscurité '+level+' %</label><div class="form-fields">'+
      '<input name="depth'+i+'" type="number" min="0" step="'+step+'" value="'+localEscape(current[i])+'"><span class="units">'+units+'</span></div></div>').join('')+
      '</div>',
    ok:{label:"Enregistrer",icon:"fa-solid fa-save",callback:(_event,button)=>{
      const fields=button.form.elements;
      if(fields.automatic.checked)return {lightDepths:null};
      const values=[0,1,2,3].map(i=>{
        const raw=String(fields["depth"+i].value??"").trim();
        const n=raw===""?NaN:Number(raw);
        return Number.isFinite(n)&&n>=0?Math.round(n/step)*step:NaN;
      });
      if(!normalizeWaterLightDepths(values))throw Error("Les profondeurs doivent être positives ou nulles et croissantes.");
      return {lightDepths:values};
    }},rejectClose:false,modal:true
  });
  if(!result)return;
  try{
    const latest=getSceneWaterBody(scene,body.id);
    if(!latest)throw Error("Corps d’eau introuvable.");
    await saveSceneWaterBody(scene,{...latest,lightDepths:result.lightDepths});
    // The updateScene hook regenerates the native darkness Regions.
    ui.notifications.info("Profondeurs de lumière enregistrées pour « "+latest.name+" ».");
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
