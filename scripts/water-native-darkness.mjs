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
import { getWaterRegionData, getWaterDepthBandSettings, isWaterRegion } from "./water-regions.mjs";
import { getTokenWaterState } from "./water-state.mjs";
import { isWaterObserverSubmerged, getWaterObserverEyeElevation } from "./water-visual-depth.mjs";
import {
  globalWaterLightFactor, hasSceneGlobalIllumination,
  refreshWaterGlobalLighting
} from "./water-global-light.mjs";

const TYPE="adjustDarknessLevel";
const FLAG="nativeWaterDepth";
const BANDS_OWNED_FLAG="depthBandsManaged";
const BANDS_PRIOR_FLAG="depthBandsPreviouslyDisabled";
const MODE_OVERRIDE=0;
const MODE_DARKEN=2;
const EPS=1e-4;
const TRANSITION_MS=450;
const MIN_TICK_MS=75;
const cached=new Map();
const transitions=new Map();
let ticker=null;
let lastTick=0;
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

/**
 * Persistently prevent the parent water Region's native darkness behavior
 * from competing with the independent, altitude-banded OVERRIDE behaviors.
 *
 * A management flag remembers whether the GM had previously disabled this
 * behavior. Re-enabling ordinary lighting restores that original state.
 * Do not modify unrelated/manual Region behaviors.
 */
export async function syncNativeWaterDarknessBandExclusivity(region) {
  if (!game.user?.isGM || !region) return false;
  const behavior=getNativeWaterDarknessBehavior(region);
  if (!behavior || typeof behavior.update!=="function") return false;
  const banded=isWaterRegion(region) && getWaterDepthBandSettings(region).enabled;
  const managed=(behavior.getFlag?.(MODULE_ID,BANDS_OWNED_FLAG) ??
    behavior.flags?.[MODULE_ID]?.[BANDS_OWNED_FLAG])===true;
  const previouslyDisabled=(behavior.getFlag?.(MODULE_ID,BANDS_PRIOR_FLAG) ??
    behavior.flags?.[MODULE_ID]?.[BANDS_PRIOR_FLAG])===true;
  if (banded) {
    if (managed && behavior.disabled) return false;
    const changes={disabled:true};
    if (!managed) {
      changes[`flags.${MODULE_ID}.${BANDS_OWNED_FLAG}`]=true;
      changes[`flags.${MODULE_ID}.${BANDS_PRIOR_FLAG}`]=behavior.disabled===true;
    }
    await behavior.update(changes);
    return true;
  }
  if (!managed) return false;
  // Reset any local OVERRIDE left by the former dynamic-lighting mode
  // before allowing the core behavior to become active again.
  if (typeof behavior.system?.updateSource==="function")
    behavior.system.updateSource({mode:MODE_DARKEN,modifier:0});
  await behavior.update({
    disabled:previouslyDisabled,
    [`flags.${MODULE_ID}.${BANDS_OWNED_FLAG}`]:false
  });
  return true;
}

export async function ensureNativeWaterDarknessBehavior(region){
  if(!game.user?.isGM||!isWaterRegion(region)||
      typeof region.createEmbeddedDocuments!=="function")return null;
  let current=getNativeWaterDarknessBehavior(region);
  if(current){
    await syncNativeWaterDarknessBandExclusivity(region);
    return current;
  }
  const banded=getWaterDepthBandSettings(region).enabled;
  const added=await region.createEmbeddedDocuments("RegionBehavior",[{
    name:"PF1 Waters — Obscurité selon profondeur",
    type:TYPE,disabled:banded,
    system:{mode:MODE_DARKEN,modifier:0},
    flags:{[MODULE_ID]:{
      [FLAG]:true,
      ...(banded ? {[BANDS_OWNED_FLAG]:true,[BANDS_PRIOR_FLAG]:false} : {})
    }}
  }]);
  return added?.[0]??null;
}
export async function ensureSceneNativeWaterDarkness(scene=globalThis.canvas?.scene){
  if(!game.user?.isGM||!scene||ensuring)return 0;
  ensuring=true;
  let count=0;
  try{
    for(const region of scene.regions??[]){
      if(!isWaterRegion(region))continue;
      try{
        if(getNativeWaterDarknessBehavior(region)){
          await syncNativeWaterDarknessBandExclusivity(region);
        }else if(await ensureNativeWaterDarknessBehavior(region))count++;
      }
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
        s.region.parent?.id!==scene?.id ||
        getWaterDepthBandSettings(s.region).enabled)continue;
    const depth=Math.max(0,s.surface-getWaterObserverEyeElevation(token,s));
    const sunlightHalfDepth=getWaterRegionData(s.region).sunlightHalfDepth;
    const fraction=globalWaterLightFactor(depth,sunlightHalfDepth);
    const darkness=calculateNativeWaterDarkness(base,fraction);
    const old=values.get(s.region.id);
    if(!old||darkness<old.darkness)
      values.set(s.region.id,{region:s.region,depth,fraction,darkness,base,sunlightHalfDepth});
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
function refreshNativePerception(){
  globalThis.canvas?.perception?.update?.({
    initializeLighting:true,initializeVision:true,
    refreshLighting:true,refreshVision:true
  });
}
function stopTicker(){
  ticker?.remove?.(tickNativeWaterDarkness);
  ticker=null;
}
function startTicker(){
  const candidate=globalThis.canvas?.app?.ticker;
  if(!candidate?.add||!candidate?.remove)return false;
  if(ticker===candidate)return true;
  stopTicker();
  ticker=candidate;
  ticker.add(tickNativeWaterDarkness);
  return true;
}
/** Animate native Region darkness without persisting data or affecting other clients. */
function tickNativeWaterDarkness(){
  const now=Date.now();
  if(now-lastTick<MIN_TICK_MS)return;
  lastTick=now;
  let updates=0;
  for(const [id,transition] of transitions){
    if(transition.behavior.disabled){
      transitions.delete(id);
      continue;
    }
    const progress=clamp((now-transition.startedAt)/TRANSITION_MS);
    const eased=progress*progress*(3-2*progress);
    const value=transition.from+(transition.to-transition.from)*eased;
    if(applyNativeWaterDarkness(transition.behavior,value))updates++;
    if(progress>=1)transitions.delete(id);
  }
  if(updates)refreshNativePerception();
  if(!transitions.size)stopTicker();
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
      // A banded source has its own persisted OVERRIDE Regions. If the
      // parent was erroneously re-enabled by the GM, never adjust it
      // locally; the GM synchronizer will persist the disabled state.
      if(getWaterDepthBandSettings(region).enabled){
        transitions.delete(region.id);
        cached.delete(region.id);
        continue;
      }
      seen.add(region.id);
      const t=target.get(region.id);
      const level=t&&t.darkness>t.base+EPS?t.darkness:null;
      const transition=transitions.get(region.id);
      if(level===null){
        transitions.delete(region.id);
        if(applyNativeWaterDarkness(b,null))updates++;
      }else if(transition&&transition.behavior===b&&Math.abs(transition.to-level)<EPS){
        // Repeated sight refreshes must not restart an existing transition.
      }else{
        const from=b.system.mode===MODE_OVERRIDE
          ?clamp(finite(b.system.modifier,t.base)):t.base;
        if(Math.abs(from-level)<EPS||!startTicker()){
          transitions.delete(region.id);
          if(applyNativeWaterDarkness(b,level))updates++;
        }else{
          transitions.set(region.id,{behavior:b,from,to:level,startedAt:Date.now()});
          if(applyNativeWaterDarkness(b,from))updates++;
        }
      }
      cached.set(region.id,b);
    }
    for(const [id,b] of cached){
      if(seen.has(id))continue;
      transitions.delete(id);
      applyNativeWaterDarkness(b,null);
      cached.delete(id);
    }
    // Once a native Region behavior is present, remove any legacy darkness
    // overlay that was created before the GM installed that behavior.
    refreshWaterGlobalLighting();
    if(!transitions.size)stopTicker();
    if(updates)refreshNativePerception();
  }finally{syncing=false;}
  return updates;
}
export function resetNativeWaterDarkness(){
  transitions.clear();
  stopTicker();
  for(const b of cached.values())applyNativeWaterDarkness(b,null);
  cached.clear();
}
export function nativeWaterDarknessDiagnostics(){
  const c=globalThis.canvas;
  return {
    sceneDarkness:c?.scene?.environment?.darknessLevel??null,
    globalLight:c?.scene?.environment?.globalLight??null,
    regions:[...getNativeWaterDarknessTargets(c?.scene)].map(([id,v])=>({
      id,depth:v.depth,sunlightHalfDepth:v.sunlightHalfDepth,
      physicalLightPercent:100*v.fraction,
      nativeDarkness:v.darkness,
      appliedDarkness:getNativeWaterDarknessBehavior(v.region)?.system?.modifier??null,
      transitioning:transitions.has(id),
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
