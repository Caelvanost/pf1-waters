import test from "node:test";
import assert from "node:assert/strict";
import {
  WATER_LIGHT_PROFILES,DEFAULT_WATER_CLARITY,getWaterClarityProfile,
  getWaterClaritySettings,inferLegacyWaterClarity,
  waterSunlightTransmission,waterDepthForTransmission,
  waterVisualLightResponse,metersPerWaterUnit
} from "../scripts/water-optics.mjs";
import { globalWaterLightFactor } from "../scripts/water-global-light.mjs";
import { waterVisionFraction } from "../scripts/water-vision.mjs";

const near=(a,b,t=1e-10)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const scene=units=>({grid:{units}});

test("five progressively murkier profiles control BOTH visibility and sunlight",()=>{
  assert.deepEqual(WATER_LIGHT_PROFILES.map(p=>p.id),[
    "crystal","clear","slightlyMurky","murky","silty"
  ]);
  assert.equal(DEFAULT_WATER_CLARITY,"clear");
  for(let i=1;i<WATER_LIGHT_PROFILES.length;i++){
    assert.ok(WATER_LIGHT_PROFILES[i-1].kd<WATER_LIGHT_PROFILES[i].kd);
    assert.ok(WATER_LIGHT_PROFILES[i-1].visibilityMeters>
      WATER_LIGHT_PROFILES[i].visibilityMeters);
  }
  assert.equal(getWaterClarityProfile("unknown"),null);
  const clear=getWaterClaritySettings(scene("m"),"clear");
  near(clear.visionRange,25);
  near(clear.visionHalfDepth,Math.LN2/.07);
  assert.equal(clear.waterClarity,"clear");
  assert.equal(getWaterClaritySettings(scene("m"),"unknown"),null);
});

test("Beer-Lambert sunlight is continuous, never hard-zeroed at 5x or 20x",()=>{
  for(const [depth,expected] of [[0,1],[5,2**-.5],[10,.5],[20,.25],
    [40,.0625],[60,.015625],[100,2**-10],[200,2**-20]]){
    near(waterSunlightTransmission(depth,10),expected);
    near(globalWaterLightFactor(depth,10),expected);
    near(waterVisionFraction(depth,10),expected);
  }
  assert.ok(waterSunlightTransmission(200,10)>0);
  assert.ok(waterSunlightTransmission(201,10)<waterSunlightTransmission(200,10));
  assert.equal(waterSunlightTransmission(0,0),1);
  assert.equal(waterSunlightTransmission(1,0),0);
  assert.equal(waterSunlightTransmission(8,-1),1);
});

test("inverse law places light bands at logarithmic depths",()=>{
  for(const fraction of [.99,.5,.1,.01,.001,2**-20]){
    near(waterSunlightTransmission(
      waterDepthForTransmission(fraction,12),12),fraction,1e-12);
  }
  near(waterDepthForTransmission(.01,10),66.43856189774725);
  assert.equal(waterDepthForTransmission(1,10),0);
  assert.equal(waterDepthForTransmission(0,10),Infinity);
});

test("light and visibility profiles are expressed in Scene distance units",()=>{
  const metre=getWaterClaritySettings(scene("m"),"clear");
  for(const [units,ratio] of [["m",1],["ft",.3048],["feet",.3048],
    ["pieds",.3048],["cm",.01],["mm",.001],["km",1000],["mi",1609.344]]){
    near(metersPerWaterUnit(scene(units)),ratio);
    const settings=getWaterClaritySettings(scene(units),"clear");
    near(settings.visionRange*ratio,metre.visionRange);
    near(settings.visionHalfDepth*ratio,metre.visionHalfDepth);
  }
});

test("legacy numeric water values are mapped to closest choice ONLY in UI",()=>{
  assert.equal(inferLegacyWaterClarity(scene("m"),40,20),"crystal");
  assert.equal(inferLegacyWaterClarity(scene("m"),25,10),"clear");
  assert.equal(inferLegacyWaterClarity(scene("m"),2,1),"silty");
  assert.equal(inferLegacyWaterClarity(scene("m"),0,0),DEFAULT_WATER_CLARITY);
});

test("graphic adaptation is gradual, and does not invent a PF1 threshold",()=>{
  assert.equal(waterVisualLightResponse(1),1);
  assert.equal(waterVisualLightResponse(0),0);
  assert.ok(waterVisualLightResponse(.01)>0);
  assert.ok(waterVisualLightResponse(.12)>0);
  assert.ok(waterVisualLightResponse(.25)>.25);
});
