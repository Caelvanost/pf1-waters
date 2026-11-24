import test from "node:test";
import assert from "node:assert/strict";
import { planWaterDepthBands,syncSceneWaterDepthBands,waterDepthBandDiagnostics } from "../scripts/water-depth-bands.mjs";
function fixture(depth=100,half=10){
 globalThis.game={user:{isGM:true}};
 const scene={id:"s",grid:{units:"m"},environment:{darknessLevel:0,globalLight:{enabled:true}},regions:[],
 flags:{"pf1-waters":{waterBodies:[{id:"body",name:"Mer",surface:0,visionHalfDepth:half}]}},
 getFlag(s,k){return this.flags?.[s]?.[k];},
 async deleteEmbeddedDocuments(type,ids){assert.equal(type,"Region");this.regions=this.regions.filter(r=>!ids.includes(r.id));},
 async createEmbeddedDocuments(type,defs){assert.equal(type,"Region");const docs=defs.map((d,i)=>({...d,id:"band-"+i,parent:this,getFlag(s,k){return this.flags?.[s]?.[k];}}));this.regions.push(...docs);return docs;}};
 const region={id:"water",name:"Mer",parent:scene,behaviors:[],flags:{"pf1-waters":{waterRegion:{enabled:true,bodyId:"body",depth}}},
 getFlag(s,k){return this.flags?.[s]?.[k];},toObject(){return {shapes:[{type:"rectangle",x:0,y:0,width:100,height:100}]};}};
 const manual={id:"manual",parent:scene,behaviors:[]};
 scene.regions=[region,manual];return {scene,region,manual};
}
test("four fixed native bands, adjacent, floor bounded",()=>{
 const {scene,region}=fixture();const b=planWaterDepthBands(region,scene);
 assert.deepEqual(b.map(x=>x.darkness),[.25,.5,.75,1]);
 assert.equal(b.at(-1).bottom,-100);
 assert.equal(b[0].top,-1.5);
 assert.deepEqual(b.map(x=>x.top),[-1.5,-7.5,-13.5,-30]);
 for(let i=1;i<b.length;i++)assert.equal(b[i-1].bottom,b[i].top);
});
test("shallow water does not create auxiliary Regions",()=>{const {scene,region}=fixture(1);assert.deepEqual(planWaterDepthBands(region,scene),[]);});
test("zero half depth yields only fully dark band",()=>{const {scene,region}=fixture(10,0);assert.deepEqual(planWaterDepthBands(region,scene),[{index:3,top:0,bottom:-10,darkness:1}]);});
test("sync is idempotent, uses native DARKEN, cleans orphan and preserves manual regions",async()=>{
 const {scene,region,manual}=fixture();scene.regions.push({id:"orphan",flags:{"pf1-waters":{waterDepthLightBand:{sourceId:"missing"}}}});
 const first=await syncSceneWaterDepthBands(scene);assert.equal(first.created,4);assert.equal(first.removed,1);
 assert.equal(waterDepthBandDiagnostics(scene).length,4);
 assert.ok(scene.regions.filter(r=>r.id.startsWith("band-")).every(r=>r.behaviors[0].system.mode===2));
 assert.equal((await syncSceneWaterDepthBands(scene)).created,0);
 region.flags["pf1-waters"].waterRegion.depth=1;
 assert.equal((await syncSceneWaterDepthBands(scene)).removed,4);
 assert.deepEqual(scene.regions,[region,manual]);
});
test("players never write",async()=>{const {scene}=fixture();game.user.isGM=false;assert.equal((await syncSceneWaterDepthBands(scene)).skipped,true);});

test("coincident rounded thresholds skip empty bands and retain exact physical floor",()=>{
 const {scene,region}=fixture(4.2,.1);const b=planWaterDepthBands(region,scene);
 assert.deepEqual(b,[{index:3,top:-1.5,bottom:-4.2,darkness:1}]);
});
test("imperial thresholds align to five-foot squares",()=>{
 const {scene,region}=fixture(100,10);scene.grid.units="ft";const b=planWaterDepthBands(region,scene);
 assert.ok(b.length>0);assert.ok(b.every(x=>x.top%5===0));
});

test("custom water body light depths override automatic profile and respect bottom",()=>{
 const {scene,region}=fixture(20,10);
 scene.flags["pf1-waters"].waterBodies[0].lightDepths=[3,6,12,24];
 assert.deepEqual(planWaterDepthBands(region,scene),[
 {index:0,top:-3,bottom:-6,darkness:.25},{index:1,top:-6,bottom:-12,darkness:.5},{index:2,top:-12,bottom:-20,darkness:.75}]);
});
