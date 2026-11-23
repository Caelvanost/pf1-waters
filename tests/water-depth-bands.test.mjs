import test from "node:test";
import assert from "node:assert/strict";
import { isWaterRegion } from "../scripts/water-regions.mjs";
import {
  planWaterDepthBands, getWaterDepthBandInfo, isWaterDepthBand,
  syncSceneWaterDepthBands, waterDepthBandDiagnostics
} from "../scripts/water-depth-bands.mjs";

globalThis.game = {user:{isGM:true}};

function fixture({depth:nullOrDepth=null, halfDepth=5, count=24, enabled=true,
  darkness=0, globalLight=true}={}) {
  const scene = {
    id:"scene-bands", environment:{
      darknessLevel:darkness, globalLight:{enabled:globalLight}
    }, grid:{size:100,distance:1.5,units:"m"}, regions:[],
    flags:{"pf1-waters":{waterBodies:[{id:"body",name:"Lac",surface:0,visionHalfDepth:halfDepth}]}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    async createEmbeddedDocuments(type, values) {
      assert.equal(type,"Region");
      const created=values.map((data,index)=>{
        const copy=JSON.parse(JSON.stringify(data));
        const value={
          ...copy,id:"generated-"+(this.regions.length+index),
          parent:this,
          getFlag(scope,key){return this.flags?.[scope]?.[key];}
        };
        this.regions.push(value);
        return value;
      });
      return created;
    },
    async deleteEmbeddedDocuments(type,ids) {
      assert.equal(type,"Region");
      this.regions=this.regions.filter(r=>!ids.includes(r.id));
      return ids;
    }
  };
  const region = {
    id:"water",name:"Lagon",parent:scene,
    flags:{"pf1-waters":{waterRegion:{
      enabled:true,bodyId:"body",depth:nullOrDepth,visibilityDepth:36,
      sunlightHalfDepth:halfDepth,
      darknessBands:enabled,darknessBandCount:count
    }}},
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    toObject(){return {shapes:[
      {type:"rectangle",x:0,y:0,width:300,height:300},
      {type:"polygon",points:[10,10,20,10,15,20],hole:true}
    ]};}
  };
  // Model the native darkness behavior automatically attached to a water
  // Region by PF1 Waters, and verify the synchronization is persisted.
  const managed={type:"adjustDarknessLevel",disabled:false,
    system:{mode:2,modifier:0,updateSource(value){Object.assign(this,value);}},
    flags:{"pf1-waters":{nativeWaterDepth:true}},
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    updates:0,
    async update(changes) {
      this.updates++;
      if(Object.hasOwn(changes,"disabled"))this.disabled=changes.disabled;
      for(const [key,value] of Object.entries(changes)){
        if(!key.startsWith("flags.pf1-waters."))continue;
        this.flags["pf1-waters"][key.slice("flags.pf1-waters.".length)]=value;
      }
    }
  };
  region.behaviors=[managed];
  scene.regions.push(region);
  return {scene,region,managed};
}

test("bands follow decreasing sunlight in real, adjacent V13 elevation ranges",()=>{
  const {scene,region}=fixture();
  const bands=planWaterDepthBands(region,scene);
  assert.equal(bands.length,25,"24 illuminated strata and a final dark stratum");
  assert.equal(bands[0].top,0);
  assert.equal(bands.at(-1).bottom,null,"unlimited water continues to -Infinity");
  for(let i=0;i<bands.length;i++){
    assert.ok(bands[i].top>bands[i].bottom || bands[i].bottom===null);
    assert.ok(bands[i].darkness>=0&&bands[i].darkness<=1);
    if(i) {
      assert.ok(Math.abs(bands[i-1].bottom-bands[i].top)<1e-6,
        "adjacent altitude intervals must not leave gaps");
      assert.ok(bands[i-1].darkness<=bands[i].darkness,
        "the next deeper stratum must not become brighter");
    }
  }
  assert.ok(bands[0].darkness>0);
  assert.equal(bands.at(-1).darkness,1);
});

test("finite water body stops at its own physical floor",()=>{
  const {scene,region}=fixture({depth:12});
  const bands=planWaterDepthBands(region,scene);
  assert.equal(bands.length,24);
  assert.ok(Math.abs(bands.at(-1).bottom+12)<1e-7);
  assert.equal(bands.at(0).top,0);
});

test("zero half-depth produces one fully dark band",()=>{
  const {scene,region}=fixture({halfDepth:0,depth:10});
  const bands=planWaterDepthBands(region,scene);
  assert.equal(bands.length,1);
  assert.equal(bands[0].top,0);
  assert.equal(bands[0].bottom,-10);
  assert.equal(bands[0].darkness,1);
});

test("disabled, unlit scenes and water body with zero depth get no bands",()=>{
  const x=fixture({enabled:false});
  assert.deepEqual(planWaterDepthBands(x.region,x.scene),[]);
  const y=fixture({globalLight:false});
  assert.deepEqual(planWaterDepthBands(y.region,y.scene),[]);
  const z=fixture({depth:0});
  assert.deepEqual(planWaterDepthBands(z.region,z.scene),[]);
});

test("GM creates persistent native OVERRIDE darkness Regions, idempotently",async()=>{
  const {scene,region,managed}=fixture();
  const first=await syncSceneWaterDepthBands(scene);
  assert.equal(managed.disabled,true,
    "the parent Region behavior must not compete with lighting bands");
  assert.equal(managed.getFlag("pf1-waters","depthBandsManaged"),true);
  assert.equal(first.created,25);
  const lights=scene.regions.filter(isWaterDepthBand);
  assert.equal(lights.length,25);
  assert.ok(lights.every(b=>!isWaterRegion(b)));
  assert.ok(lights.every(b=>b.locked&&b.visibility===0));
  assert.ok(lights.every(b=>b.behaviors.length===1&&
    b.behaviors[0].type==="adjustDarknessLevel"&&
    b.behaviors[0].system.mode===0));
  assert.ok(lights.every(b=>Array.isArray(b.shapes)&&b.shapes.length===2));
  assert.ok(lights.every(b=>getWaterDepthBandInfo(b).sourceId===region.id));
  assert.ok(lights.every(b=>typeof getWaterDepthBandInfo(b).signature==="string"));
  assert.equal((await syncSceneWaterDepthBands(scene)).created,0);
  assert.equal(managed.updates,1,"idempotent parent behavior sync");
  assert.equal(scene.regions.filter(isWaterDepthBand).length,25);
  assert.equal(waterDepthBandDiagnostics(scene).length,25);
});

test("changing water depth, scenery darkness, or disabling mode regenerates and cleans up",async()=>{
  const {scene,region,managed}=fixture({count:8,depth:10});
  assert.equal((await syncSceneWaterDepthBands(scene)).created,8);
  scene.environment.darknessLevel=.4;
  const updated=await syncSceneWaterDepthBands(scene);
  assert.equal(updated.removed,8);
  assert.equal(updated.created,8);
  region.flags["pf1-waters"].waterRegion.darknessBands=false;
  assert.equal((await syncSceneWaterDepthBands(scene)).removed,8);
  assert.equal(scene.regions.length,1);
  assert.equal(managed.disabled,false,
    "turning off bands must restore native parent darkness");
});

test("manual re-enabling parent darkness is repaired during band synchronization",async()=>{
  const {scene,managed}=fixture({count:8});
  await syncSceneWaterDepthBands(scene);
  managed.disabled=false;
  const updated=await syncSceneWaterDepthBands(scene);
  assert.equal(managed.disabled,true);
  assert.equal(updated.created,0,"correcting parent must not regenerate bands");
  assert.equal(updated.removed,0);
});
test("the module never alters another independent manual darkness behavior",async()=>{
  const {scene,region,managed}=fixture({count:8});
  const manual={
    type:"adjustDarknessLevel",disabled:false,flags:{},
    getFlag(){return undefined;}
  };
  region.behaviors.push(manual);
  await syncSceneWaterDepthBands(scene);
  assert.equal(managed.disabled,true);
  assert.equal(manual.disabled,false);
});
test("a player never creates or removes lighting Regions",async()=>{
  const {scene}=fixture();
  game.user.isGM=false;
  try{
    const response=await syncSceneWaterDepthBands(scene);
    assert.equal(response.skipped,true);
    assert.equal(scene.regions.length,1);
  }finally{game.user.isGM=true;}
});

test("deleting source Region removes only the linked synthetic Regions",async()=>{
  const {scene}=fixture({count:8});
  await syncSceneWaterDepthBands(scene);
  scene.regions=scene.regions.filter(r=>r.id!=="water");
  const deleted=await syncSceneWaterDepthBands(scene);
  assert.equal(deleted.removed,9,"8 brightness bands and their final dark band");
  assert.equal(scene.regions.length,0);
});
