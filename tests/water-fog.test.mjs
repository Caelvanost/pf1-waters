import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveFogObservers, hasUnderwaterFogObserver,
  discardUnderwaterFogPending, patchWaterFogExploration,
  waterFogDiagnostics
} from "../scripts/water-fog.mjs";

function fixture(){
  const scene={
    id:"sea",grid:{size:100,distance:1.5,units:"m"},
    regions:[],tokens:[],
    flags:{"pf1-waters":{waterBodies:[{
      id:"bay",name:"Baie",surface:0,visionEnabled:true,
      visionRange:36,visionHalfDepth:9
    }]}} ,
    getFlag(ns,key){return this.flags?.[ns]?.[key];}
  };
  const region={
    id:"water",parent:scene,elevation:{bottom:-50,top:0},
    flags:{"pf1-waters":{waterRegion:{enabled:true,bodyId:"bay",depth:50}}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    testPoint({x,y,elevation}){
      return x>=0&&x<1000&&y>=0&&y<1000&&elevation>=-50&&elevation<=0;
    }
  };
  scene.regions.push(region);
  function viewer(id,{x=0,elevation=-5,losHeight=-3}={}){
    const document={
      id,parent:scene,x,y:0,width:1,height:1,elevation,
      getFlag(){return undefined;}
    };
    const token={document,losHeight};
    document.object=token;
    return token;
  }
  class FakeFog{
    commits=0;saves=0;persisted=["known surface"];
    commit(){
      this.commits++;
      this.persisted.push(...globalThis.canvas.visibility.explored);
    }
    async save(){this.saves++;}
  }
  class FakeVisibility{
    explored=[];resetCount=0;refreshCount=0;
    resetExploration(){this.resetCount++;this.explored=[];}
    refreshVisibility(){this.refreshCount++;}
  }
  const fog=new FakeFog(),visibility=new FakeVisibility();
  globalThis.canvas={
    ready:true,scene,fog,visibility,
    effects:{visionSources:new Map()},
    tokens:{controlled:[]}
  };
  const diver=viewer("diver");
  const dry=viewer("dry",{elevation:1,losHeight:2});
  canvas.effects.visionSources.set(diver.document.id,{active:true,object:diver});
  return {scene,diver,dry,fog,visibility,FakeFog,FakeVisibility};
}

test("underwater sources are found from active V13 vision-source collection",()=>{
  const {diver,dry}=fixture();
  assert.deepEqual(getActiveFogObservers(),[diver]);
  assert.equal(hasUnderwaterFogObserver(),true);
  canvas.effects.visionSources.get("diver").active=false;
  assert.equal(hasUnderwaterFogObserver(),false);
  canvas.tokens.controlled=[dry];
  assert.equal(hasUnderwaterFogObserver(),false);
  canvas.tokens.controlled=[diver];
  assert.equal(hasUnderwaterFogObserver(),true);
});

test("fog explored while submerged is temporary, not committed or saved",async()=>{
  const {fog,visibility,FakeFog,FakeVisibility}=fixture();
  assert.equal(patchWaterFogExploration(FakeFog,FakeVisibility),true);
  assert.equal(patchWaterFogExploration(FakeFog,FakeVisibility),true,
    "patches are installed only once");
  visibility.explored.push("underwater beach");
  fog.commit();
  await fog.save();
  assert.equal(fog.commits,0);
  assert.equal(fog.saves,0);
  assert.deepEqual(fog.persisted,["known surface"]);
  assert.equal(waterFogDiagnostics().pendingDiscard,true);
  visibility.refreshVisibility();
  assert.equal(visibility.resetCount,1);
  assert.deepEqual(visibility.explored,[]);
  visibility.explored.push("underwater reef");
  fog.commit();
  assert.equal(fog.commits,0);
});

test("resurfacing discards unsaved underwater shapes before normal fog resumes",async()=>{
  const {diver,fog,visibility,FakeFog,FakeVisibility}=fixture();
  patchWaterFogExploration(FakeFog,FakeVisibility);
  visibility.explored.push("not saved");
  fog.commit();
  diver.losHeight=2;
  diver.document.elevation=1;
  fog.commit();
  assert.equal(fog.commits,1);
  assert.deepEqual(fog.persisted,["known surface"],
    "underwater shapes must never be included in the native fog commit");
  assert.equal(discardUnderwaterFogPending(fog),false);
  visibility.explored.push("dry deck");
  fog.commit();
  await fog.save();
  assert.equal(fog.commits,2);
  assert.equal(fog.saves,1);
  assert.deepEqual(fog.persisted,["known surface","dry deck"]);
  assert.equal(waterFogDiagnostics().suspended,false);
});

test("a dry observer and diver together never persist underwater pixels",()=>{
  const {dry,fog,visibility,FakeFog,FakeVisibility}=fixture();
  patchWaterFogExploration(FakeFog,FakeVisibility);
  canvas.effects.visionSources.set("dry",{active:true,object:dry});
  visibility.explored.push("mixed scene");
  fog.commit();
  assert.equal(fog.commits,0,
    "shared V13 2D fog has no source-local committed exploration");
  assert.equal(hasUnderwaterFogObserver(),true);
  canvas.effects.visionSources.get("diver").active=false;
  fog.commit();
  assert.deepEqual(fog.persisted,["known surface"]);
  assert.equal(visibility.resetCount,1);
});

test("unrelated scenes with no underwater viewers retain normal exploration",async()=>{
  const {fog,visibility,FakeFog,FakeVisibility}=fixture();
  patchWaterFogExploration(FakeFog,FakeVisibility);
  canvas.effects.visionSources.clear();
  visibility.explored.push("dry area");
  fog.commit();
  await fog.save();
  assert.equal(fog.commits,1);
  assert.equal(fog.saves,1);
  assert.deepEqual(fog.persisted,["known surface","dry area"]);
});
