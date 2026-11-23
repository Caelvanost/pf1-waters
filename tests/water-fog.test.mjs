import test from "node:test";
import assert from "node:assert/strict";
import {
  getActiveFogObservers, hasUnderwaterFogObserver,
  discardUnderwaterFogPending, patchWaterFogExploration,
  syncUnderwaterFogDisplay,restoreUnderwaterFogDisplay,
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
    sprite={visible:true,renderable:true};
    commit(){
      this.commits++;
      this.persisted.push(...globalThis.canvas.visibility.explored);
    }
    async save(){this.saves++;}
  }
  class FakeVisibility{
    explored=[];resetCount=0;refreshCount=0;
    constructor(){
      this.explored.visible=true;
      this.explored.renderable=true;
    }
    resetExploration(){
      this.resetCount++;
      // Foundry reuses the exploration container; it does not replace the
      // live CanvasVisibility.explored property on a simple reset.
      this.explored.length=0;
    }
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

test("submerged rendering masks historical fog, while native current LOS remains active",()=>{
  const {fog,visibility,FakeFog,FakeVisibility,diver}=fixture();
  visibility.vision={visible:true,renderable:true};
  assert.equal(patchWaterFogExploration(FakeFog,FakeVisibility),true);
  assert.equal(syncUnderwaterFogDisplay(),true);
  assert.equal(visibility.explored.visible,false);
  assert.equal(visibility.explored.renderable,false);
  assert.equal(fog.sprite.visible,false,"persisted FogManager.sprite must be hidden");
  assert.equal(fog.sprite.renderable,false);
  assert.equal(visibility.vision.visible,true,"current visible polygons must remain");
  assert.equal(visibility.vision.renderable,true);
  assert.equal(waterFogDiagnostics().exploredHidden,true);
  assert.equal(waterFogDiagnostics().fogSpriteHidden,true);

  // The framework refresh may overwrite sprite flags: reapply after refresh.
  visibility.explored.visible=true;
  fog.sprite.visible=true;
  visibility.refreshVisibility();
  assert.equal(visibility.explored.visible,false);
  assert.equal(fog.sprite.visible,false);

  // The protection applies even if the area was explored prior to diving.
  diver.losHeight=2;
  diver.document.elevation=1;
  assert.equal(syncUnderwaterFogDisplay(),true);
  assert.equal(visibility.explored.visible,true);
  assert.equal(visibility.explored.renderable,true);
  assert.equal(fog.sprite.visible,true);
  assert.equal(fog.sprite.renderable,true);
  assert.equal(visibility.vision.visible,true);
  assert.equal(waterFogDiagnostics().exploredHidden,false);
});

test("fog display is only hidden when at least one active source is immersed",()=>{
  const {fog,visibility,dry}=fixture();
  canvas.effects.visionSources.set("surface",{active:true,object:dry});
  assert.equal(syncUnderwaterFogDisplay(),true);
  assert.equal(visibility.explored.visible,false);
  canvas.effects.visionSources.get("diver").active=false;
  assert.equal(syncUnderwaterFogDisplay(),true);
  assert.equal(visibility.explored.visible,true);
  assert.equal(fog.sprite.visible,true);
  assert.equal(syncUnderwaterFogDisplay(),false);
});

test("fog display restoration does not destroy persisted exploration data",()=>{
  const {fog,visibility}=fixture();
  const recorded=fog.persisted.slice();
  syncUnderwaterFogDisplay();
  restoreUnderwaterFogDisplay();
  assert.equal(visibility.explored.visible,true);
  assert.equal(fog.sprite.renderable,true);
  assert.deepEqual(fog.persisted,recorded);
});
