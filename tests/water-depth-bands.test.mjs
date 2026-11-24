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
 assert.ok(Math.abs(b[0].top+10*Math.log2(1/.875))<1e-9);
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
