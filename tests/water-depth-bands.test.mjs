import test from "node:test";
import assert from "node:assert/strict";
import { planWaterDepthBands,syncSceneWaterDepthBands,waterDepthBandDiagnostics } from "../scripts/water-depth-bands.mjs";
function fixture(){
  globalThis.game={user:{isGM:true}};
  const scene={id:"s",regions:[],async deleteEmbeddedDocuments(type,ids){
    assert.equal(type,"Region");this.regions=this.regions.filter(r=>!ids.includes(r.id));
  },async createEmbeddedDocuments(){throw Error("Never create a depth band");}};
  const behavior={type:"adjustDarknessLevel",disabled:true,system:{updateSource(){}},
    flags:{"pf1-waters":{nativeWaterDepth:true,depthBandsManaged:true,depthBandsPreviouslyDisabled:false}},
    async update(changes){this.disabled=changes.disabled;this.flags["pf1-waters"].depthBandsManaged=false;}};
  const region={id:"water",parent:scene,behaviors:[behavior],getFlag(){return undefined;}};
  const manual={id:"manual",parent:scene,behaviors:[]};
  const band={id:"band",parent:scene,flags:{"pf1-waters":{waterDepthLightBand:{sourceId:"water"}}}};
  const orphan={id:"orphan",parent:scene,flags:{"pf1-waters":{waterDepthLightBand:{sourceId:"missing"}}}};
  scene.regions=[region,manual,band,orphan];
  return {scene,region,manual,behavior};
}
test("legacy planner never generates bands",()=>assert.deepEqual(planWaterDepthBands(),[]));
test("migration deletes only owned bands and orphans, restores parent, is idempotent",async()=>{
  const {scene,region,manual,behavior}=fixture();
  assert.equal(waterDepthBandDiagnostics(scene).length,2);
  assert.deepEqual(await syncSceneWaterDepthBands(scene),{created:0,removed:2,skipped:false});
  assert.deepEqual(scene.regions,[region,manual]);
  assert.equal(behavior.disabled,false);
  assert.equal((await syncSceneWaterDepthBands(scene)).removed,0);
});
test("migration never writes as player",async()=>{
  const {scene}=fixture();game.user.isGM=false;
  assert.equal((await syncSceneWaterDepthBands(scene)).skipped,true);
  assert.equal(scene.regions.length,4);
});
