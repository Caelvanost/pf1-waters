import test from "node:test";
import assert from "node:assert/strict";
import {
  getSceneWaterBodies,getSceneWaterBody,getRegionWaterBodyId,
  areWaterRegionsInSameBody,saveSceneWaterBody,deleteSceneWaterBody
} from "../scripts/water-bodies.mjs";
import {
  getWaterRegionData,getWaterBottomElevation,
  pointInsideWaterRegion2D,attachSelectedWaterRegionsToBody,
  registerWaterRegionSceneControls
} from "../scripts/water-regions.mjs";
import { getTokenWaterState } from "../scripts/water-state.mjs";
import { measureProjectileWaterDistance } from "../scripts/water-projectiles.mjs";
import {
  getWaterSurfaceData,getWaterSurfacesForRegion,
  syncWaterSurfaceElevation,assignSelectedSurfacesToBody,
  registerWaterSurfaceSceneControls
} from "../scripts/water-surface-links.mjs";

globalThis.game={user:{isGM:true,id:"GM"},i18n:{localize:x=>x}};
globalThis.ui={notifications:{info(){},warn(message){throw Error(message);},error(message){throw Error(message);}}};
globalThis.foundry={
  utils:{escapeHTML:v=>String(v),randomID:()=> "uniqueBody"},
  applications:{api:{DialogV2:{prompt:async()=>null,confirm:async()=>true}}}
};

function scene() {
  return {
    id:"s",flags:{"pf1-waters":{waterBodies:[
      {id:"bay",name:"Baie",surface:0},
      {id:"creek",name:"Ruisseau",surface:2}
    ]}},
    grid:{size:100,distance:1.5,units:"m"},
    regions:[],tiles:[],drawings:[],tokens:[],
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    async setFlag(scope,key,value){
      this.flags[scope]??={};
      this.flags[scope][key]=value;
    }
  };
}
function region(s,{id="beach",bodyId="bay",depth=2,xmin=0,xmax=100,bottom=-2}={}){
  const r={
    id,name:id,parent:s,
    elevation:{bottom,top:0},
    flags:{"pf1-waters":{waterRegion:{
      enabled:true,bodyId,surface:999,depth,
      sunlightHalfDepth:5,visibilityDepth:36
    }}},
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    async setFlag(scope,key,value){
      this.flags[scope]??={};this.flags[scope][key]=value;
    },
    testPoint({x,y,elevation}){
      return x>=xmin&&x<xmax&&y>=0&&y<100&&
        elevation>=this.elevation.bottom&&elevation<=this.elevation.top;
    }
  };
  s.regions.push(r);return r;
}
function token(s,{id="token",x=0,elevation=0}={}){
  const t={id,parent:s,x,y:0,width:1,height:1,elevation,
    getFlag(){return undefined;},movementAction:"swim"};
  s.tokens.push(t);return t;
}
function tile(s,{id="water-art",x=0,width=200,kind="Tile"}={}){
  const t={
    id,parent:s,documentName:kind,x,y:0,width,height:100,elevation:99,
    flags:{"pf1-waters":{waterSurface:{enabled:true,bodyId:"bay",
      syncElevation:true,keepVisible:true}}},
    occlusion:{mode:1},
    getFlag(scope,key){return this.flags?.[scope]?.[key];},
    async setFlag(scope,key,value){
      this.flags[scope]??={};this.flags[scope][key]=value;
    },
    async update(changes){
      for(const [key,val] of Object.entries(changes))
        if(key==="occlusion.mode")this.occlusion.mode=val;else this[key]=val;
    }
  };
  (kind==="Tile"?s.tiles:s.drawings).push(t);
  return t;
}

test("a Scene registry owns the common surface while regions keep independent bottoms",()=>{
  const s=scene();
  const a=region(s,{depth:2,bottom:-2,xmin:0,xmax:100});
  const b=region(s,{id:"deep",depth:20,bottom:-20,xmin:100,xmax:200});
  assert.equal(getSceneWaterBodies(s).length,2);
  assert.equal(getSceneWaterBody(s,"bay").name,"Baie");
  assert.equal(getRegionWaterBodyId(a),"bay");
  assert.equal(getWaterRegionData(a).surface,0);
  assert.equal(getWaterRegionData(b).surface,0);
  assert.equal(getWaterBottomElevation(a),-2);
  assert.equal(getWaterBottomElevation(b),-20);
  assert.ok(areWaterRegionsInSameBody(a,b));
  assert.ok(!areWaterRegionsInSameBody(a,region(s,{
    id:"creek-segment",bodyId:"creek",depth:8,xmin:200,xmax:300,bottom:-6
  })));
});
test("Regions with different native elevation ranges are detected by their 2D shape",()=>{
  const s=scene();
  const near=region(s,{depth:2,bottom:-2,xmin:0,xmax:100});
  const deep=region(s,{id:"deep",depth:20,bottom:-20,xmin:100,xmax:200});
  assert.ok(pointInsideWaterRegion2D({x:60,y:40},near));
  assert.ok(pointInsideWaterRegion2D({x:160,y:40},deep));
  assert.ok(!pointInsideWaterRegion2D({x:160,y:40},near));
  const shallow=token(s,{id:"shallow",x:10,elevation:-1.5});
  const diver=token(s,{id:"diver",x:110,elevation:-10});
  assert.equal(getTokenWaterState(shallow).regionId,near.id);
  assert.equal(getTokenWaterState(diver).regionId,deep.id);
  assert.equal(getTokenWaterState(shallow).bottom,-2);
  assert.equal(getTokenWaterState(diver).bottom,-20);
  const dry=token(s,{id:"dry",x:10,elevation:-10});
  assert.equal(getTokenWaterState(dry).inWater,false);
});
test("a single body-linked water Tile serves both Regions, aligned at common surface",async()=>{
  const s=scene();const a=region(s);const b=region(s,{id:"deep",depth:20,bottom:-20,xmin:100,xmax:200});
  const water=tile(s);
  assert.equal(getWaterSurfaceData(water).bodyId,"bay");
  assert.deepEqual(getWaterSurfacesForRegion(a),[water]);
  assert.deepEqual(getWaterSurfacesForRegion(b),[water]);
  assert.equal(await syncWaterSurfaceElevation(water),true);
  assert.equal(water.elevation,0);
  await saveSceneWaterBody(s,{id:"bay",name:"Baie",surface:4});
  assert.equal(getWaterRegionData(a).surface,4);
  assert.equal(getWaterRegionData(b).surface,4);
  assert.equal(getWaterBottomElevation(a),2);
  assert.equal(getWaterBottomElevation(b),-16);
  assert.equal(await syncWaterSurfaceElevation(water),true);
  assert.equal(water.elevation,4);
});
test("crossing water segments counts every submerged portion without gaps",()=>{
  const s=scene();region(s);region(s,{id:"deep",depth:20,bottom:-20,xmin:100,xmax:200});
  const from=token(s,{id:"a",x:0,elevation:-1});
  const to=token(s,{id:"b",x:100,elevation:-1});
  const hit=measureProjectileWaterDistance({source:from,target:to,samplesPerGrid:48});
  assert.ok(hit.fraction>0.99);
  assert.deepEqual(hit.touchedRegionIds,["beach","deep"]);
});
test("save/edit body keeps its stable id; delete blocks linked Regions and Tiles",async()=>{
  const s=scene();const r=region(s);const water=tile(s);
  await assert.rejects(deleteSceneWaterBody(s,"bay"),/Dissociez/);
  await saveSceneWaterBody(s,{id:"bay",name:"Nouvelle baie",surface:1.5});
  assert.equal(getSceneWaterBody(s,"bay").name,"Nouvelle baie");
  assert.equal(getSceneWaterBody(s,"bay").surface,1.5);
  assert.equal(r.flags["pf1-waters"].waterRegion.surface,999,
    "shared surface must be resolved dynamically, not copied to every Region");
  r.flags["pf1-waters"].waterRegion.bodyId=null;
  water.flags["pf1-waters"].waterSurface.bodyId=null;
  assert.equal(await deleteSceneWaterBody(s,"bay"),true);
  assert.equal(getSceneWaterBody(s,"bay"),null);
});
test("Region attach action uses individual bottom limits and preserves each geometry",async()=>{
  const s=scene();
  const first=region(s,{id:"a",bodyId:null,depth:2,bottom:-1});
  const second=region(s,{id:"b",bodyId:null,depth:20,bottom:-10,xmin:100,xmax:200});
  globalThis.canvas={scene:s,regions:{controlled:[{document:first},{document:second}]}};
  const old=foundry.applications.api.DialogV2.prompt;
  foundry.applications.api.DialogV2.prompt=async()=>({
    bodyId:"bay",depth:8,useRegionBottom:true
  });
  try{await attachSelectedWaterRegionsToBody();}
  finally{foundry.applications.api.DialogV2.prompt=old;}
  assert.equal(getWaterRegionData(first).depth,1);
  assert.equal(getWaterRegionData(second).depth,10);
  assert.equal(getRegionWaterBodyId(first),"bay");
  assert.equal(getRegionWaterBodyId(second),"bay");
  assert.deepEqual(first.elevation,{bottom:-1,top:0});
  assert.deepEqual(second.elevation,{bottom:-10,top:0});
});
test("Tile/Drawing association tool binds a full body, not just one Region",async()=>{
  const s=scene();region(s);region(s,{id:"deep",depth:10,xmin:100,xmax:200,bottom:-10});
  const t=tile(s,{kind:"Tile"}),d=tile(s,{kind:"Drawing"});
  t.flags["pf1-waters"].waterSurface={enabled:false};
  d.flags["pf1-waters"].waterSurface={enabled:false};
  globalThis.canvas={scene:s,tiles:{controlled:[{document:t}]},
    drawings:{controlled:[{document:d}]}};
  const old=foundry.applications.api.DialogV2.prompt;
  foundry.applications.api.DialogV2.prompt=async()=>({
    bodyId:"bay",syncElevation:true,visibilityDepth:4,keepVisible:true
  });
  try{
    await assignSelectedSurfacesToBody("Tile");
    await assignSelectedSurfacesToBody("Drawing");
  }finally{foundry.applications.api.DialogV2.prompt=old;}
  for(const obj of [t,d]){
    assert.equal(getWaterSurfaceData(obj).bodyId,"bay");
    assert.equal(obj.elevation,0);
  }
  assert.equal(t.occlusion.mode,0);
  const controls={regions:{tools:{}},tiles:{tools:{}},drawings:{tools:{}}};
  registerWaterRegionSceneControls(controls);
  registerWaterSurfaceSceneControls(controls);
  assert.equal(controls.regions.tools.pf1WatersBodies,undefined,
    "la gestion des corps d'eau se trouve à la racine de la barre d'outils");
  assert.equal(controls.regions.tools.pf1WatersClear,undefined,
    "l'action Retirer la propriété eau est redondante avec Dissocier");
  assert.equal(typeof controls.regions.tools.pf1WatersConfigure?.onChange,"function");
  assert.equal(typeof controls.regions.tools.pf1WatersDetachRegion?.onChange,"function");
  assert.equal(typeof controls.regions.tools.pf1WatersAttachRegion?.onChange,"function");
  assert.equal(typeof controls.tiles.tools.pf1WatersTileBodySurface?.onChange,"function");
  assert.equal(typeof controls.drawings.tools.pf1WatersDrawingBodySurface?.onChange,"function");
});
