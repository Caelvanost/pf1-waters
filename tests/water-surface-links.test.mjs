import test from "node:test";
import assert from "node:assert/strict";
import {
  getWaterSurfaceData,getWaterSurfacesForRegion,
  syncWaterSurfaceElevation,syncSceneWaterSurfaceElevations,
  syncWaterSurfaceVisibility,syncSceneWaterSurfaceVisibilities,
  assignSelectedSurfacesToBody,clearSelectedWaterSurfaces,
  registerWaterSurfaceSceneControls
} from "../scripts/water-surface-links.mjs";
import { getTokenWaterState } from "../scripts/water-state.mjs";

globalThis.game={
  user:{id:"GM",isGM:true},users:{activeGM:{id:"GM"}},
  i18n:{localize:key=>key}
};
globalThis.ui={notifications:{info(){},warn(message){throw Error(message);}}};
globalThis.foundry={
  utils:{escapeHTML:text=>String(text).replaceAll("&","&amp;").replaceAll("<","&lt;")},
  applications:{api:{DialogV2:{prompt:async()=>({
    bodyId:"bay",syncElevation:true,visibilityDepth:5,keepVisible:true
  })}}}
};
function makeScene(){
  return {
    id:"scene",regions:[],tiles:[],drawings:[],
    flags:{"pf1-waters":{waterBodies:[{id:"bay",name:"Baie",surface:4}]}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    grid:{size:100,distance:1.5,units:"m"}
  };
}
function region(scene,id="shallows",depth=2){
  const r={
    id,name:id,parent:scene,
    flags:{"pf1-waters":{waterRegion:{enabled:true,bodyId:"bay",depth}}},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    testPoint(){return true;}
  };
  scene.regions.push(r);
  return r;
}
function placeable(scene,type="Tile",id="water"){
  const doc={
    documentName:type,id,parent:scene,elevation:0,
    occlusion:{mode:1,alpha:.5},flags:{},
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;},
    async update(changes){
      for(const [key,value] of Object.entries(changes))
        if(key==="occlusion.mode")this.occlusion.mode=value;else this[key]=value;
    }
  };
  (type==="Tile"?scene.tiles:scene.drawings).push(doc);
  return doc;
}
function link(doc,bodyId="bay",syncElevation=true){
  doc.flags["pf1-waters"]={waterSurface:{enabled:true,bodyId,syncElevation}};
}

test("one visual water body surface serves multiple Regions, not one Region ID",()=>{
  const s=makeScene(),r1=region(s),r2=region(s,"deep",18),
    t=placeable(s),d=placeable(s,"Drawing");
  link(t);link(d);
  assert.deepEqual(getWaterSurfaceData(t),{
    enabled:true,bodyId:"bay",syncElevation:true,visibilityDepth:3,
    keepVisible:true,previousOcclusionMode:null
  });
  assert.deepEqual(getWaterSurfacesForRegion(r1),[t,d]);
  assert.deepEqual(getWaterSurfacesForRegion(r2),[t,d]);
  assert.equal(t.getFlag("pf1-waters","waterRegion"),undefined);
});

test("unlinked and orphan surfaces are never considered water",()=>{
  const s=makeScene(),r=region(s),t=placeable(s);
  link(t,"nonexistent");
  assert.deepEqual(getWaterSurfacesForRegion(r),[]);
  const token={id:"token",parent:s,x:0,y:0,width:1,height:1,elevation:9};
  assert.equal(getTokenWaterState(token).inWater,false);
});

test("all body-linked visual surfaces follow the shared surface elevation",async()=>{
  const s=makeScene();region(s);const t=placeable(s),d=placeable(s,"Drawing");
  link(t);link(d);
  assert.equal(await syncWaterSurfaceElevation(t),true);
  assert.equal(await syncWaterSurfaceElevation(d),true);
  assert.equal(t.elevation,4);
  assert.equal(d.elevation,4);
  s.flags["pf1-waters"].waterBodies[0].surface=7;
  assert.deepEqual(await syncSceneWaterSurfaceElevations(s),{aligned:2,failed:0});
  assert.equal(t.elevation,7);
  assert.equal(d.elevation,7);
});

test("disable auto elevation follows the explicit Tile/Drawing value",async()=>{
  const s=makeScene();region(s);const d=placeable(s,"Drawing");
  link(d,"bay",false);d.elevation=11;
  assert.equal(await syncWaterSurfaceElevation(d),false);
  assert.equal(d.elevation,11);
});

test("the new Tile and Drawing tools attach to a water body and detach safely",async()=>{
  const s=makeScene();const r=region(s);
  const t=placeable(s),d=placeable(s,"Drawing");
  globalThis.canvas={
    scene:s,tiles:{controlled:[{document:t}]},
    drawings:{controlled:[{document:d}]}
  };
  const controls={tiles:{tools:{}},drawings:{tools:{}}};
  registerWaterSurfaceSceneControls(controls);
  assert.equal(typeof controls.tiles.tools.pf1WatersTileBodySurface.onChange,"function");
  assert.equal(typeof controls.drawings.tools.pf1WatersDrawingBodySurface.onChange,"function");
  assert.equal(controls.tiles.tools.pf1WatersTileLinkTool,undefined,
    "old Region-specific link command must be gone");
  await assignSelectedSurfacesToBody("Tile");
  await assignSelectedSurfacesToBody("Drawing");
  assert.equal(getWaterSurfaceData(t).bodyId,"bay");
  assert.equal(getWaterSurfaceData(d).bodyId,"bay");
  assert.equal(t.elevation,4);
  assert.equal(d.elevation,4);
  assert.equal(t.occlusion.mode,0);
  assert.equal(r.getFlag("pf1-waters","waterRegion").enabled,true);
  await clearSelectedWaterSurfaces("Tile");
  assert.equal(getWaterSurfaceData(t).enabled,false);
  assert.equal(getWaterSurfaceData(t).bodyId,null);
  assert.equal(t.occlusion.mode,1);
});

test("visibility limit defaults to two grid distances and accepts zero",()=>{
  const s=makeScene();region(s);const t=placeable(s);link(t);
  assert.equal(getWaterSurfaceData(t).visibilityDepth,3);
  s.grid.distance=5;
  assert.equal(getWaterSurfaceData(t).visibilityDepth,10);
  t.flags["pf1-waters"].waterSurface.visibilityDepth=0;
  assert.equal(getWaterSurfaceData(t).visibilityDepth,0);
});

test("surface visibility never changes physical Region depth",async()=>{
  const s=makeScene(),r=region(s),t=placeable(s);link(t);
  t.flags["pf1-waters"].waterSurface.visibilityDepth=2.5;
  await syncWaterSurfaceElevation(t);
  assert.equal(r.getFlag("pf1-waters","waterRegion").depth,2);
});

test("native Tile occlusion is restored on unlink",async()=>{
  const s=makeScene();region(s);const t=placeable(s);
  link(t);t.occlusion.mode=4;t.occlusion.alpha=.37;
  assert.equal(await syncWaterSurfaceVisibility(t),true);
  assert.equal(t.occlusion.mode,0);
  assert.equal(t.occlusion.alpha,.37);
  assert.equal(getWaterSurfaceData(t).previousOcclusionMode,4);
  assert.equal(await syncWaterSurfaceVisibility(t),false);
  assert.equal((await syncSceneWaterSurfaceVisibilities(s)).changed,0);
  t.flags["pf1-waters"].waterSurface.enabled=false;
  assert.equal(await syncWaterSurfaceVisibility(t),true);
  assert.equal(t.occlusion.mode,4);
  assert.equal(getWaterSurfaceData(t).previousOcclusionMode,null);
});

test("orphaned and hidden surfaces are never unhidden by the module",async()=>{
  const s=makeScene(),t=placeable(s);
  link(t,"gone");t.occlusion.mode=3;t.hidden=true;
  assert.equal(await syncWaterSurfaceVisibility(t),false);
  assert.equal(t.occlusion.mode,3);
  assert.equal(t.hidden,true);
});

test("Drawing never changes native Tile occlusion",async()=>{
  const s=makeScene(),r=region(s),d=placeable(s,"Drawing");
  link(d);
  assert.equal(await syncWaterSurfaceVisibility(d),false);
  assert.equal(r.flags["pf1-waters"].waterRegion.depth,2);
});
