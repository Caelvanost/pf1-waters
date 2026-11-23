import test from "node:test";
import assert from "node:assert/strict";
import {
  getNativeWaterDarknessBehavior,ensureNativeWaterDarknessBehavior,
  ensureSceneNativeWaterDarkness,getNativeWaterDarknessTargets,
  calculateNativeWaterDarkness,applyNativeWaterDarkness,
  refreshNativeWaterDarkness,resetNativeWaterDarkness,
  nativeWaterDarknessDiagnostics,registerNativeWaterDarknessHooks,
  syncNativeWaterDarknessBandExclusivity
} from "../scripts/water-native-darkness.mjs";

const calls=[];
globalThis.game={user:{id:"GM",isGM:true}};
globalThis.Hooks={on:(name,cb)=>calls.push([name,cb])};
function makeRegion({distance=36,sunlightHalfDepth=null,water=true,depth=1000}={}) {
  const scene={id:"sc",environment:{darknessLevel:.2,globalLight:{enabled:true,darkness:{max:.8}}},
    grid:{size:100,distance:1.5,units:"m"},regions:[],tokens:[],
    flags:{"pf1-waters":{waterBodies:[{id:"body",name:"Lac",surface:0,visionHalfDepth:sunlightHalfDepth??distance}]}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];}
  };
  const region={id:"r1",parent:scene,behaviors:[],elevation:0,
    flags:{"pf1-waters":{waterRegion:{enabled:water,bodyId:"body",depth,visibilityDepth:distance,
      ...(sunlightHalfDepth===null?{}:{sunlightHalfDepth})}}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    testPoint({x,y}){return x>=0&&x<100&&y>=0&&y<100;},
    async createEmbeddedDocuments(type,defs){
      assert.equal(type,"RegionBehavior");calls.push(["createBehavior",defs]);
      const entries=defs.map((data,i)=>{
        const system={...data.system,updateSource(value){
          Object.assign(this,value);calls.push(["localUpdate",value]);
        }};
        return {...data,id:"managed-"+i,system,
          getFlag(ns,key){return this.flags?.[ns]?.[key];}};
      });
      this.behaviors.push(...entries);
      return entries;
    }
  };
  scene.regions.push(region);
  const observer={
    document:{id:"viewer",parent:scene,x:0,y:0,width:1,height:1,
      elevation:-37.5,sight:{visionMode:"basic"},getFlag(){return undefined;}},
    losHeight:-36
  };
  const perception={update(opts){calls.push(["perception",opts]);}};
  globalThis.canvas={ready:true,scene,
    tokens:{controlled:[observer]},effects:{visionSources:new Map()},
    perception
  };
  return {scene,region,observer,perception};
}
function clean(){resetNativeWaterDarkness();calls.length=0;game.user.isGM=true;}
test("calculation is anchored to the Scene darkness and the sunlight knots",()=>{
  assert.equal(calculateNativeWaterDarkness(0,1),0);
  assert.equal(calculateNativeWaterDarkness(0,.5),.5);
  assert.ok(Math.abs(calculateNativeWaterDarkness(.2,.5)-.6)<1e-12);
  assert.ok(Math.abs(calculateNativeWaterDarkness(.2,.25)-.8)<1e-12);
  assert.equal(calculateNativeWaterDarkness(.2,0),1);
  assert.equal(calculateNativeWaterDarkness(.7,1),.7);
  assert.equal(calculateNativeWaterDarkness(1,.5),1);
});
test("GM creates exactly one neutral core Adjust Darkness Level behavior",async()=>{
  clean();const {region}=makeRegion();
  assert.equal(getNativeWaterDarknessBehavior(region),null);
  const behavior=await ensureNativeWaterDarknessBehavior(region);
  assert.equal(behavior.type,"adjustDarknessLevel");
  assert.equal(behavior.system.mode,2);
  assert.equal(behavior.system.modifier,0);
  assert.equal(behavior.getFlag("pf1-waters","nativeWaterDepth"),true);
  assert.equal(await ensureNativeWaterDarknessBehavior(region),behavior);
  assert.equal(calls.filter(c=>c[0]==="createBehavior").length,1);
  clean();
});
test("banded mode persistently disables only the PF1 Waters parent darkness behavior",async()=>{
  clean();
  const {region}=makeRegion();
  const behavior=await ensureNativeWaterDarknessBehavior(region);
  const manuallyConfigured={type:"adjustDarknessLevel",disabled:false,
    flags:{},getFlag(){return undefined;}};
  region.behaviors.push(manuallyConfigured);
  behavior.update=async function(changes){
    if(Object.hasOwn(changes,"disabled"))this.disabled=changes.disabled;
    for(const [path,value] of Object.entries(changes)){
      if(!path.startsWith("flags.pf1-waters."))continue;
      this.flags["pf1-waters"][path.slice("flags.pf1-waters.".length)]=value;
    }
    calls.push(["persist",changes]);
  };
  region.flags["pf1-waters"].waterRegion.darknessBands=true;
  assert.equal(await syncNativeWaterDarknessBandExclusivity(region),true);
  assert.equal(behavior.disabled,true);
  assert.equal(behavior.getFlag("pf1-waters","depthBandsManaged"),true);
  assert.equal(behavior.getFlag("pf1-waters","depthBandsPreviouslyDisabled"),false);
  assert.equal(manuallyConfigured.disabled,false,"unrelated GM behaviors are not modified");
  assert.equal(await syncNativeWaterDarknessBandExclusivity(region),false,
    "the sync must be idempotent");
  // Even a manual re-enable cannot leave conflicting overrides active.
  behavior.disabled=false;
  assert.equal(await syncNativeWaterDarknessBandExclusivity(region),true);
  assert.equal(behavior.disabled,true);
  region.flags["pf1-waters"].waterRegion.darknessBands=false;
  assert.equal(await syncNativeWaterDarknessBandExclusivity(region),true);
  assert.equal(behavior.disabled,false);
  assert.equal(behavior.getFlag("pf1-waters","depthBandsManaged"),false);
  assert.equal(await syncNativeWaterDarknessBandExclusivity(region),false);
  clean();
});
test("originally disabled parent behavior stays disabled after turning off bands",async()=>{
  clean();
  const {region}=makeRegion();
  const behavior=await ensureNativeWaterDarknessBehavior(region);
  behavior.disabled=true;
  behavior.update=async function(changes){
    if(Object.hasOwn(changes,"disabled"))this.disabled=changes.disabled;
    for(const [path,value] of Object.entries(changes)){
      if(path.startsWith("flags.pf1-waters."))
        this.flags["pf1-waters"][path.slice("flags.pf1-waters.".length)]=value;
    }
  };
  region.flags["pf1-waters"].waterRegion.darknessBands=true;
  await syncNativeWaterDarknessBandExclusivity(region);
  region.flags["pf1-waters"].waterRegion.darknessBands=false;
  await syncNativeWaterDarknessBandExclusivity(region);
  assert.equal(behavior.disabled,true);
  clean();
});
test("a newly-created parent behavior begins disabled when banding is enabled",async()=>{
  clean();
  const {region}=makeRegion();
  region.flags["pf1-waters"].waterRegion.darknessBands=true;
  const behavior=await ensureNativeWaterDarknessBehavior(region);
  assert.equal(behavior.disabled,true);
  assert.equal(behavior.getFlag("pf1-waters","depthBandsManaged"),true);
  assert.equal(behavior.getFlag("pf1-waters","depthBandsPreviouslyDisabled"),false);
  clean();
});
test("persisted elevation bands disable the ineffective client-only darkness override",()=>{
  clean();
  const {scene,region,observer}=makeRegion();
  region.flags["pf1-waters"].waterRegion.darknessBands=true;
  assert.equal(getNativeWaterDarknessTargets(scene,[observer]).size,0);
  region.flags["pf1-waters"].waterRegion.darknessBands=false;
  assert.equal(getNativeWaterDarknessTargets(scene,[observer]).size,1);
  clean();
});
test("independent sunlight half-depth modifies native darkness, not token sight",()=>{
  clean();
  const {scene,region,observer}=makeRegion({distance:36,sunlightHalfDepth:18});
  const t=getNativeWaterDarknessTargets(scene,[observer]).get(region.id);
  assert.equal(t.depth,36);
  assert.equal(t.sunlightHalfDepth,18);
  assert.equal(t.fraction,.25);
  assert.ok(Math.abs(t.darkness-.8)<1e-12);
  clean();
});
test("a player cannot create or persist a Region behavior",async()=>{
  clean();const {region}=makeRegion();game.user.isGM=false;
  assert.equal(await ensureNativeWaterDarknessBehavior(region),null);
  assert.equal(calls.filter(c=>c[0]==="createBehavior").length,0);
  clean();
});
test("only the actual viewer's immersed LOS determines per-client native darkness",async()=>{
  clean();const {region,scene,observer}=makeRegion();
  await ensureNativeWaterDarknessBehavior(region);
  let targets=getNativeWaterDarknessTargets(scene,[observer]);
  let data=targets.get(region.id);
  assert.equal(data.depth,36);
  assert.equal(data.fraction,.5);
  assert.ok(Math.abs(data.darkness-.6)<1e-12);
  observer.document.elevation=-.75;observer.losHeight=.1;
  assert.equal(getNativeWaterDarknessTargets(scene,[observer]).size,0);
  observer.document.elevation=-151.5;observer.losHeight=-150;
  data=getNativeWaterDarknessTargets(scene,[observer]).get(region.id);
  assert.ok(Math.abs(data.fraction-Math.exp(-Math.LN2*150/36))<1e-12);
  assert.ok(data.darkness>.9,"native Region crosses 0.8 global-light threshold");
  clean();
});
test("per-client native behavior changes source and triggers Foundry perception, never update()",async()=>{
  clean();const {region,observer}=makeRegion();
  const behavior=await ensureNativeWaterDarknessBehavior(region);
  behavior.update=()=>{throw Error("must not persist temporary viewpoint depth")};
  assert.equal(refreshNativeWaterDarkness(),1);
  assert.equal(behavior.system.mode,0);
  assert.ok(Math.abs(behavior.system.modifier-.6)<1e-12);
  assert.equal(calls.filter(c=>c[0]==="perception").length,1);
  assert.equal(refreshNativeWaterDarkness(),0,"idempotent refresh");
  observer.document.elevation=-.75;observer.losHeight=0.5;
  assert.equal(refreshNativeWaterDarkness(),1);
  assert.equal(behavior.system.mode,2);
  assert.equal(behavior.system.modifier,0);
  assert.equal(calls.filter(c=>c[0]==="perception").length,2);
  clean();
});
test("depth changes cause smooth native darkness interpolation on canvas ticker",async()=>{
  clean();
  const {region,observer}=makeRegion();
  const behavior=await ensureNativeWaterDarknessBehavior(region);
  const callbacks=new Set();
  canvas.app={ticker:{add(fn){callbacks.add(fn);},remove(fn){callbacks.delete(fn);}}};
  const originalNow=Date.now;
  let now=1000;
  Date.now=()=>now;
  try{
    assert.equal(refreshNativeWaterDarkness(),1);
    assert.equal(behavior.system.mode,0);
    assert.equal(behavior.system.modifier,.2);
    assert.equal(callbacks.size,1);
    now=1150;
    [...callbacks][0]();
    assert.ok(behavior.system.modifier>.2&&behavior.system.modifier<.6);
    observer.document.elevation=-73.5;
    observer.losHeight=-72;
    assert.equal(refreshNativeWaterDarkness(),0);
    now=1700;
    [...callbacks][0]();
    assert.ok(Math.abs(behavior.system.modifier-.8)<1e-12);
    assert.equal(callbacks.size,0);
  }finally{
    Date.now=originalNow;
    clean();
  }
});
test("native darkness is independent of token darkvision because Foundry checks it",async()=>{
  clean();const {region,observer}=makeRegion();
  await ensureNativeWaterDarknessBehavior(region);
  const normal=getNativeWaterDarknessTargets().get(region.id).darkness;
  observer.document.sight.visionMode="darkvision";
  const darkvision=getNativeWaterDarknessTargets().get(region.id).darkness;
  assert.equal(darkvision,normal,"special sight handled in native Foundry perception");
  clean();
});
test("GM free camera always restores neutral and does not corrupt the Scene setting",async()=>{
  clean();const {region,scene}=makeRegion();
  const b=await ensureNativeWaterDarknessBehavior(region);
  refreshNativeWaterDarkness();
  assert.equal(b.system.mode,0);
  canvas.tokens.controlled=[];
  refreshNativeWaterDarkness();
  assert.equal(b.system.mode,2);
  assert.equal(scene.environment.darknessLevel,.2);
  assert.equal(b.system.modifier,0);
  clean();
});
test("a water Region with native darkness follows Scene global-light configuration",async()=>{
  clean();const {region,scene}=makeRegion();
  const b=await ensureNativeWaterDarknessBehavior(region);
  assert.equal(refreshNativeWaterDarkness(),1);
  scene.environment.globalLight.enabled=false;
  assert.equal(refreshNativeWaterDarkness(),1);
  assert.equal(b.system.mode,2);
  assert.equal(b.system.modifier,0);
  clean();
});
test("existing Regions are retrofitted only by a GM and only once",async()=>{
  clean();const {scene}=makeRegion();
  assert.equal(await ensureSceneNativeWaterDarkness(scene),1);
  assert.equal(await ensureSceneNativeWaterDarkness(scene),0);
  clean();
});
test("diagnostics include native target and Scene darkness",async()=>{
  clean();const {region}=makeRegion();
  await ensureNativeWaterDarknessBehavior(region);
  const d=nativeWaterDarknessDiagnostics();
  assert.equal(d.sceneDarkness,.2);
  assert.equal(d.regions.length,1);
  assert.ok(Math.abs(d.regions[0].nativeDarkness-.6)<1e-12);
  assert.equal(d.regions[0].behaviorReady,true);
  clean();
});
test("native darkness hook lifecycle includes vision and Scene changes",()=>{
  clean();registerNativeWaterDarknessHooks();
  for(const name of ["canvasReady","controlToken","updateToken","updateScene","sightRefresh","canvasTearDown"]){
    assert.ok(calls.some(c=>c[0]===name));
  }
  clean();
});
