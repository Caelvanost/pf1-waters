/**
 * PF1 Waters - Foundry v13 native Adjust Darkness Level Region behavior.
 *
 * Managed Regions store a neutral (DARKEN, modifier=0) core behavior.
 * Each client alone updates the local DataModel to its controlled token's
 * viewpoint darkness using updateSource. No elevation-dependent values are
 * sent to the server or written into the Scene darkness setting.
 *
 * Foundry's own Region/Global Illumination Threshold then controls whether
 * the Region is mechanically lit and respects actual light sources, walls
 * and native special vision modes.
 */
import { MODULE_ID, finite } from "./constants.mjs";
import { getWaterRegionData, isWaterRegion } from "./water-regions.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { isWaterObserverSubmerged, getWaterObserverEyeElevation } from "./water-visual-depth.mjs";
import { globalWaterLightFactor, hasSceneGlobalIllumination } from "./water-global-light.mjs";

const TYPE="adjustDarknessLevel";
const FLAG="nativeWaterDepth";
const MODE_OVERRIDE=0;
const MODE_DARKEN=2;
const EPS=1e-4;
const cached=new Map();
let syncing=false;
let ensuring=false;
const warnings=new Set();
function warn(message,e){
  if(warnings.has(message))return;
  warnings.add(message);
  console.warn(MODULE_ID+" | "+message,e??"");
}
const clamp=v=>Math.max(0,Math.min(1,v));

export function getNativeWaterDarknessBehavior(region) {
  for(const b of region?.behaviors??[]){
    if(b.type!==TYPE)continue;
    if((b.getFlag?.(MODULE_ID,FLAG)??b.flags?.[MODULE_ID]?.[FLAG])===true)
      return b;
  }
  return null;
}

export async function ensureNativeWaterDarknessBehavior(region){
  if(!game.user?.isGM||!isWaterRegion(region)||
      typeof region.createEmbeddedDocuments!=="function")return null;
  let current=getNativeWaterDarknessBehavior(region);
  if(current)return current;
  const added=await region.createEmbeddedDocuments("RegionBehavior",[{
    name:"PF1 Waters — Obscurité selon profondeur",
    type:TYPE,disabled:false,
    system:{mode:MODE_DARKEN,modifier:0},
    flags:{[MODULE_ID]:{[FLAG]:true}}
  }]);
  return added?.[0]??null;
}
export async function ensureSceneNativeWaterDarkness(scene=globalThis.canvas?.scene){
  if(!game.user?.isGM||!scene||ensuring)return 0;
  ensuring=true;
  let count=0;
  try{
    for(const region of scene.regions??[]){
      if(!isWaterRegion(region)||getNativeWaterDarknessBehavior(region))continue;
      try{if(await ensureNativeWaterDarknessBehavior(region))count++;}
      catch(e){warn("Création du comportement natif d'obscurité impossible",e);}
    }
  }finally{ensuring=false;}
  return count;
}
function viewers(){
  const c=globalThis.canvas;
  if(!c)return[];
  const selected=c.tokens?.controlled??[];
  if(game.user?.isGM&&!selected.length)return[];
  if(selected.length)return selected.filter(t=>t?.document?.parent?.id===c.scene?.id);
  const sources=c.effects?.visionSources??c.visibility?.visionSources;
  const list=new Set();
  for(const s of sources?.values?.()??[]){
    if(s?.active===false)continue;
    const t=s?.object??s?.token??s?.data?.object;
    if(t?.document?.parent?.id===c.scene?.id)list.add(t);
  }
  return [...list];
}
export function calculateNativeWaterDarkness(sceneDarkness,lightFraction){
  const base=clamp(finite(sceneDarkness,0));
  return clamp(base+(1-base)*(1-clamp(finite(lightFraction,1))));
}
export function getNativeWaterDarknessTargets(
  scene=globalThis.canvas?.scene,views=viewers()
){
  const values=new Map();
  if(!hasSceneGlobalIllumination(scene))return values;
  const base=clamp(finite(scene?.environment?.darknessLevel,0));
  for(const token of views){
    const s=getTokenWaterState(token.document);
    if(!isWaterObserverSubmerged(token,s)||!s.region||
        s.region.parent?.id!==scene?.id)continue;
    const depth=Math.max(0,s.surface-getWaterObserverEyeElevation(token,s));
    const fraction=globalWaterLightFactor(
      depth,getWaterRegionData(s.region).visibilityDepth
    );
    const darkness=calculateNativeWaterDarkness(base,fraction);
    const old=values.get(s.region.id);
    if(!old||darkness<old.darkness)
      values.set(s.region.id,{region:s.region,depth,fraction,darkness,base});
  }
  return values;
}
/**
 * updateSource() changes only this client's prepared DataModel. The neutral
 * DARKEN/0 mode ensures the Region cannot override the Scene when nobody
 * views it from underwater. OVERRIDE yields the computed native darkness.
 */
export function applyNativeWaterDarkness(behavior,darkness=null){
  if(!behavior||behavior.disabled||
      typeof behavior.system?.updateSource!=="function")return false;
  const active=Number.isFinite(darkness);
  const mode=active?MODE_OVERRIDE:MODE_DARKEN;
  const modifier=active?clamp(darkness):0;
  if(behavior.system.mode===mode&&
     Math.abs(finite(behavior.system.modifier,0)-modifier)<EPS)return false;
  try{
    behavior.system.updateSource({mode,modifier});
    return true;
  }catch(e){warn("Mise à jour locale du niveau d'obscurité impossible",e);return false;}
}
export function refreshNativeWaterDarkness(){
  const c=globalThis.canvas;
  if(!c?.ready||!c.scene||syncing)return 0;
  syncing=true;
  let updates=0;
  try{
    const target=getNativeWaterDarknessTargets(c.scene);
    const seen=new Set();
    for(const region of c.scene.regions??[]){
      const b=getNativeWaterDarknessBehavior(region);
      if(!b)continue;
      seen.add(region.id);
      const t=target.get(region.id);
      const level=t&&t.darkness>t.base+EPS?t.darkness:null;
      if(applyNativeWaterDarkness(b,level))updates++;
      cached.set(region.id,b);
    }
    for(const [id,b] of cached){
      if(seen.has(id))continue;
      applyNativeWaterDarkness(b,null);
      cached.delete(id);
    }
    if(updates){
      // Core perception re-evaluates global-light thresholds and token vision.
      c.perception?.update?.({
        initializeLighting:true,initializeVision:true,
        refreshLighting:true,refreshVision:true
      });
    }
  }finally{syncing=false;}
  return updates;
}
export function resetNativeWaterDarkness(){
  for(const b of cached.values())applyNativeWaterDarkness(b,null);
  cached.clear();
}
export function nativeWaterDarknessDiagnostics(){
  const c=globalThis.canvas;
  return {
    sceneDarkness:c?.scene?.environment?.darknessLevel??null,
    globalLight:c?.scene?.environment?.globalLight??null,
    regions:[...getNativeWaterDarknessTargets(c?.scene)].map(([id,v])=>({
      id,depth:v.depth,physicalLightPercent:100*v.fraction,
      nativeDarkness:v.darkness,
      behaviorReady:Boolean(getNativeWaterDarknessBehavior(v.region))
    }))
  };
}
export function registerNativeWaterDarknessHooks(){
  for(const event of [
    "canvasReady","controlToken","updateToken","refreshToken",
    "updateScene","createRegion","updateRegion","deleteRegion",
    "createRegionBehavior","updateRegionBehavior","deleteRegionBehavior",
    "sightRefresh"
  ])Hooks.on(event,()=>refreshNativeWaterDarkness());
  Hooks.on("canvasTearDown",()=>resetNativeWaterDarkness());
}
