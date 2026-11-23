/**
 * Optical presets for PF1 Waters (Foundry V13 / PF1 v11.11).
 *
 * Kd is an illustrative diffuse attenuation coefficient (m^-1) for
 * downwelling daylight. The *separate* maximum horizontal visibility is
 * a gameplay approximation: horizontal contrast depends on other optical
 * properties too, so it must not be presented as an exact Kd conversion.
 *
 * Relative daylight at depth: E(z)/E(0) = exp(-Kd * z).
 */
export const WATER_LIGHT_PROFILES=Object.freeze([
  Object.freeze({id:"crystal",label:"Très claire",description:"Océan limpide",
    kd:0.035,visibilityMeters:40}),
  Object.freeze({id:"clear",label:"Claire",description:"Mer claire",
    kd:0.07,visibilityMeters:25}),
  Object.freeze({id:"slightlyMurky",label:"Légèrement trouble",description:"Eau côtière",
    kd:0.15,visibilityMeters:12}),
  Object.freeze({id:"murky",label:"Trouble",description:"Baie ou estuaire",
    kd:0.30,visibilityMeters:6}),
  Object.freeze({id:"silty",label:"Vaseuse",description:"Port vaseux",
    kd:0.70,visibilityMeters:2})
]);
export const DEFAULT_WATER_CLARITY="clear";

export function getWaterClarityProfile(id){
  return WATER_LIGHT_PROFILES.find(profile=>profile.id===id)??null;
}

/** One native Scene distance unit, expressed as metres. */
export function metersPerWaterUnit(scene){
  const unit=String(scene?.grid?.units??"m").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  if(["ft","ft.","foot","feet","pied","pieds","pi"].includes(unit))return .3048;
  if(["km","kilometre","kilometres"].includes(unit))return 1000;
  if(["cm","centimetre","centimetres"].includes(unit))return .01;
  if(["mm","millimetre","millimetres"].includes(unit))return .001;
  if(["mi","mile","miles"].includes(unit))return 1609.344;
  return 1;
}

/** Profile determines BOTH daylight absorption and fixed optical range. */
export function getWaterClaritySettings(scene,id=DEFAULT_WATER_CLARITY){
  const profile=getWaterClarityProfile(id);
  if(!profile)return null;
  const metres=metersPerWaterUnit(scene);
  return {
    waterClarity:profile.id,
    visionRange:profile.visibilityMeters/metres,
    visionHalfDepth:Math.LN2/profile.kd/metres
  };
}

/**
 * Legacy water bodies have numeric settings but no named clarity profile.
 * Keep those exact values until edited. Suggest the closest preset in UI.
 */
export function inferLegacyWaterClarity(scene,range,halfDepth){
  const oldRange=Number(range)*metersPerWaterUnit(scene);
  const oldHalf=Number(halfDepth)*metersPerWaterUnit(scene);
  if(!(oldRange>0)||!(oldHalf>0))return DEFAULT_WATER_CLARITY;
  let best=DEFAULT_WATER_CLARITY,bestScore=Infinity;
  for(const p of WATER_LIGHT_PROFILES){
    const profileHalf=Math.LN2/p.kd;
    const score=Math.abs(Math.log(oldRange/p.visibilityMeters))+
      Math.abs(Math.log(oldHalf/profileHalf));
    if(score<bestScore){bestScore=score;best=p.id;}
  }
  return best;
}

export function waterSunlightTransmission(depth,halfDepth){
  const d=Number(depth);
  if(!Number.isFinite(d)||d<=0)return 1;
  const h=Number(halfDepth);
  if(!Number.isFinite(h)||h<0)return 1;
  if(h===0)return 0;
  return Math.exp(-Math.LN2*d/h);
}

export function waterDepthForTransmission(fraction,halfDepth){
  const f=Number(fraction),h=Number(halfDepth);
  if(!Number.isFinite(f)||!Number.isFinite(h)||h<0)return NaN;
  if(f>=1)return 0;
  if(f<=0)return Infinity;
  if(h===0)return 0;
  return -h*Math.log2(f);
}

/** Display adaptation approximation; not a PF1 light-level threshold. */
export function waterVisualLightResponse(irradiance){
  const fraction=Math.max(0,Math.min(1,Number(irradiance)||0));
  return Math.pow(fraction,1/2.2);
}
