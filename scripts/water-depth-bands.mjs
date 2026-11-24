/** Legacy API and migration: v1.5.0 never creates depth-light Regions. */
import { MODULE_ID } from "./constants.mjs";
import { syncNativeWaterDarknessBandExclusivity } from "./water-native-darkness.mjs";
const BAND_FLAG="waterDepthLightBand";
const activeSyncs=new Map();
export function getWaterDepthBandInfo(region){
  return region?.getFlag?.(MODULE_ID,BAND_FLAG) ?? region?.flags?.[MODULE_ID]?.[BAND_FLAG] ?? null;
}
export function isWaterDepthBand(region){return Boolean(getWaterDepthBandInfo(region)?.sourceId);}
export function planWaterDepthBands(){return [];}
async function migrate(scene){
  const regions=[...(scene.regions??[])];
  const ids=regions.filter(isWaterDepthBand).map(r=>r.id);
  if(ids.length)await scene.deleteEmbeddedDocuments("Region",ids);
  for(const region of regions){
    if(isWaterDepthBand(region))continue;
    await syncNativeWaterDarknessBandExclusivity(region);
  }
  return {created:0,removed:ids.length,skipped:false};
}
export function syncSceneWaterDepthBands(scene=globalThis.canvas?.scene){
  if(!scene||!globalThis.game?.user?.isGM||typeof scene.deleteEmbeddedDocuments!=="function")
    return Promise.resolve({created:0,removed:0,skipped:true});
  if(activeSyncs.has(scene.id))return activeSyncs.get(scene.id);
  const job=migrate(scene).finally(()=>activeSyncs.delete(scene.id));
  activeSyncs.set(scene.id,job);
  return job;
}
export function registerWaterDepthBandHooks(){
  const sync=scene=>void syncSceneWaterDepthBands(scene).catch(error=>
    console.warn(MODULE_ID+" | Migration des anciennes tranches impossible",error));
  Hooks.on("canvasReady",()=>sync(globalThis.canvas?.scene));
  Hooks.on("createRegion",region=>{if(isWaterDepthBand(region))sync(region.parent);});
}
export function waterDepthBandDiagnostics(scene=globalThis.canvas?.scene){
  return [...(scene?.regions??[])].filter(isWaterDepthBand).map(region=>({
    id:region.id,sourceId:getWaterDepthBandInfo(region).sourceId,elevation:region.elevation,
    darkness:[...(region.behaviors??[])].find(b=>b.type==="adjustDarknessLevel")?.system?.modifier??null
  }));
}
