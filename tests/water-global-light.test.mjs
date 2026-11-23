import test from "node:test";
import assert from "node:assert/strict";
import { getTokenWaterState } from "../scripts/water-state.mjs";
import { waterSunlightTransmission,waterVisualLightResponse } from "../scripts/water-optics.mjs";
const close=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} ≠ ${b}`);
const lightAt=(depth,half)=>waterSunlightTransmission(depth,half);
const alphaAt=(depth,half)=>1-waterVisualLightResponse(lightAt(depth,half));
import {
  hasSceneGlobalIllumination, globalWaterLightFactor,
  getWaterRegionGlobalLightStates,refreshWaterGlobalLighting,
  registerWaterGlobalLightingHooks, hasWaterDarkvision,
  perceivedWaterGlobalLightFactor, waterLightingDiagnostics
} from "../scripts/water-global-light.mjs";

class Container {
  constructor(){this.children=[];this.parent=null;this.destroyed=false;}
  addChild(x){this.children.push(x);x.parent=this;return x;}
  addChildAt(x,n){this.children.splice(n,0,x);x.parent=this;return x;}
  removeChild(x){this.children=this.children.filter(y=>y!==x);x.parent=null;}
  destroy(){this.destroyed=true;}
}
class Graphics {
  constructor(){this.polygons=[];this.destroyed=false;this.parent=null;}
  clear(){this.polygons=[];return this;}
  poly(p){this.polygons.push(p);return this;}
  fill(){return this;}
  destroy(){this.destroyed=true;}
}
globalThis.PIXI={Container,Graphics};
globalThis.game={user:{id:"p1",isGM:false}};
const hooks=new Map();
globalThis.Hooks={on:(id,fn)=>hooks.set(id,fn)};

function setup({light=true,limit=36,halfDepth=null}={}) {
 const sc={id:"sc",grid:{size:100,distance:1.5,units:"m"},
  environment:{globalLight:{enabled:light}},
  regions:[],tokens:[],
  flags:{"pf1-waters":{waterBodies:[{id:"body",name:"Lac",surface:0,visionHalfDepth:halfDepth??limit}]}},
  getFlag(ns,key){return this.flags?.[ns]?.[key];}
 };
 const region={id:"lake",parent:sc,elevation:0,
  triangulation:{
   vertices:new Float32Array([0,0,200,0,200,200,0,200]),
   indices:new Uint16Array([0,1,2,0,2,3])
  },
  getFlag(ns,key){return ns==="pf1-waters"&&key==="waterRegion"?
    {enabled:true,bodyId:"body",depth:200,visibilityDepth:limit,
      ...(halfDepth===null?{}:{sunlightHalfDepth:halfDepth})}:undefined;},
  testPoint({x,y}){return x>=0&&x<200&&y>=0&&y<200;}
 };
 sc.regions.push(region);
 const createViewer=(z,x=10)=>({document:{
  id:"viewer",parent:sc,x,y:10,width:1,height:1,elevation:z,
  movementAction:"swim",getFlag(){return undefined;}
 }});
 const viewer=createViewer(-19.5);
 const primary=new Container(),interfaceGroup=new Container();
 globalThis.canvas={ready:true,scene:sc,primary,interface:interfaceGroup,
  tokens:{controlled:[viewer]},effects:{visionSources:new Map()}};
 return {sc,region,viewer,primary,interfaceGroup,createViewer};
}
test("v13 global-light setting gates the effect",()=>{
 assert.equal(hasSceneGlobalIllumination({environment:{globalLight:{enabled:true}}}),true);
 assert.equal(hasSceneGlobalIllumination({environment:{globalLight:{enabled:false}}}),false);
 assert.equal(hasSceneGlobalIllumination({}),false);
});
test("Beer-Lambert natural sunlight follows an exact exponential",()=>{
  for(const [depth,fraction] of [[0,1],[18,Math.SQRT1_2],[36,.5],[54,2**-1.5],
      [72,.25],[180,1/32],[450,2**-12.5],[720,2**-20]]){
    close(globalWaterLightFactor(depth,36),fraction);
  }
  assert.ok(globalWaterLightFactor(1000,36)>0);
  close(globalWaterLightFactor(120,120),.5);
  close(globalWaterLightFactor(180,120),2**-1.5);
  close(globalWaterLightFactor(240,120),.25);
  close(globalWaterLightFactor(600,120),1/32);
  close(globalWaterLightFactor(2400,120),2**-20);
  close(globalWaterLightFactor(0,0),1);
  close(globalWaterLightFactor(.01,0),0);
  close(globalWaterLightFactor(-10,36),1);
  close(globalWaterLightFactor(10,-1),1);
});
test("observer depth and custom water visibility determine attenuation",()=>{
 const {sc}=setup({limit:36});
 const state=getWaterRegionGlobalLightStates(sc,canvas.tokens.controlled);
 assert.equal(state.length,1);
 assert.equal(state[0].depth,18);
 close(state[0].factor,lightAt(18,36));
 assert.equal(state[0].cutoff,720);
});
test("natural-light attenuation scale is independent of sight distance",()=>{
 const {sc}=setup({limit:36,halfDepth:18});
 const s=getWaterRegionGlobalLightStates(sc,canvas.tokens.controlled)[0];
 assert.equal(s.visibilityDepth,36);
 assert.equal(s.sunlightHalfDepth,18);
 assert.equal(s.depth,18);
 assert.equal(s.factor,.5);
 assert.equal(s.cutoff,360);
});
test("outside or no-global-light scenes show no underwater shading",()=>{
 const {sc,viewer}=setup();
 viewer.document.elevation=3;
 assert.equal(getWaterRegionGlobalLightStates(sc,[viewer]).length,0);
 const x=setup({light:false});
 assert.equal(getWaterRegionGlobalLightStates(x.sc,canvas.tokens.controlled).length,0);
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(canvas.interface.children.length,0);
});
test("surface-level eyes do not weaken underwater attenuation from a diver",()=>{
 const {sc,viewer,createViewer}=setup();
 const atSurface=createViewer(-1.5); // eye at exactly 0m
 const result=getWaterRegionGlobalLightStates(sc,[viewer,atSurface]);
 assert.equal(result.length,1);
 close(result[0].factor,lightAt(18,36));
});
test("two genuinely submerged viewers use their shallowest common lighting",()=>{
 const {sc,viewer,createViewer}=setup();
 const shallow=createViewer(-10.5); // eye at -9m
 const result=getWaterRegionGlobalLightStates(sc,[viewer,shallow]);
 assert.equal(result.length,1);
 assert.equal(result[0].depth,9);
 close(result[0].factor,lightAt(9,36));
});
test("graphics matches Region triangles, fades and cleans up on exit",()=>{
 const {viewer,interfaceGroup}=setup();
 viewer.document.elevation=-37.5; // top -36
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children.length,1);
 const gfx=interfaceGroup.children[0].children[0];
 assert.deepEqual(gfx.polygons,[
  [0,0,200,0,200,200],[0,0,200,200,0,200]
 ]);
 close(gfx.alpha,alphaAt(36,36));
 viewer.document.elevation=-73.5; // top -72
 assert.equal(refreshWaterGlobalLighting(),1);
 close(gfx.alpha,alphaAt(72,36));
 viewer.document.elevation=-181.5; // top -180 = 5× visibility
 assert.equal(refreshWaterGlobalLighting(),1);
 close(gfx.alpha,alphaAt(180,36));
 assert.ok(gfx.alpha<1,"no abrupt extinction after five half-depths");
 viewer.document.elevation=-201.5; // observer's volume extends beyond Region depth
 assert.equal(refreshWaterGlobalLighting(),0,"outside a Region: no attenuation overlay");
 assert.equal(interfaceGroup.children.length,0);
 assert.equal(gfx.destroyed,true);
 viewer.document.elevation=-1.5;
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
});
test("dynamic depth shading renders even if the Region has native elevation bands",()=>{
 const {region,viewer,interfaceGroup}=setup();
 region.getFlag=(namespace,key)=>
   namespace==="pf1-waters"&&key==="waterRegion"
   ? {enabled:true,bodyId:"body",depth:200,visibilityDepth:36,
      sunlightHalfDepth:5,darknessBands:true,darknessBandCount:12}
   : undefined;
 viewer.document.elevation=-19.5;
 assert.equal(getWaterRegionGlobalLightStates(canvas.scene,[viewer]).length,1);
 assert.equal(refreshWaterGlobalLighting(),1,
   "native OVERRIDE bands do not replace the per-viewer shading fallback");
 assert.equal(interfaceGroup.children.length,1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(18,36));
});
test("turning global light off removes local overlays without changing scene",()=>{
 const {sc,viewer,interfaceGroup}=setup();
 viewer.document.elevation=-37.5;
 assert.equal(refreshWaterGlobalLighting(),1);
 sc.environment.globalLight.enabled=false;
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
 assert.equal(sc.environment.globalLight.enabled,false);
});
test("GM without controlled token gets no underwater shading",()=>{
 const {viewer,interfaceGroup}=setup();
 viewer.document.elevation=-37.5;
 game.user.isGM=true;
 canvas.tokens.controlled=[];
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
 game.user.isGM=false;
 canvas.effects.visionSources.set("sight",{object:viewer,active:true});
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children.length,1);
});
test("underwater illumination hooks registered",()=>{
 registerWaterGlobalLightingHooks();
 for(const name of ["canvasReady","updateToken","updateRegion","updateScene","canvasTearDown"])
  assert.equal(typeof hooks.get(name),"function");
});

test("the solar attenuation remains exponential through deep water",()=>{
 const {sc,viewer}=setup({limit:10});
 viewer.document.elevation=-11.5; // token top -10m
 let states=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(states[0].factor,.5);
 assert.equal(states[0].cutoff,200);
 viewer.document.elevation=-21.5; // top -20m = 2×
 states=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(states[0].factor,.25);
 viewer.document.elevation=-51.5; // top -50m = 5×
 states=getWaterRegionGlobalLightStates(sc,[viewer]);
 close(states[0].factor,1/32);
 viewer.document.elevation=-201.5; // volume below finite Region; calculation still reaches 0
 close(globalWaterLightFactor(200,10),2**-20);
});
test("a non-global-light Scene never creates attenuation",()=>{
 const {sc,viewer,interfaceGroup}=setup({light:false});
 viewer.document.elevation=-90;
 assert.equal(getWaterRegionGlobalLightStates(sc,[viewer]).length,0);
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
});

test("deep water approaches black smoothly without physical zero",()=>{
 const {sc,region,viewer,interfaceGroup}=setup({limit:10});
 region.getFlag=(ns,key)=>ns==="pf1-waters"&&key==="waterRegion"
   ?{enabled:true,bodyId:"body",depth:1000,visibilityDepth:10}:undefined;
 viewer.document.elevation=-201.5; // eyes at top -200m
 const states=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(states.length,1);
 close(states[0].factor,2**-20);
 close(states[0].darkness,alphaAt(200,10));
 assert.equal(states[0].cutoff,200);
 assert.equal(refreshWaterGlobalLighting(),1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(200,10));
 viewer.document.elevation=-301.5;
 assert.equal(refreshWaterGlobalLighting(),1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(300,10));
});

test("darkening is drawn on the visible interface pass, not the cached primary",()=>{
 const {viewer,primary,interfaceGroup}=setup();
 viewer.document.elevation=-19.5; // eyes 18m under water
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(primary.children.length,0,
   "primary cached canvas must not receive the darkness overlay");
 assert.equal(interfaceGroup.children.length,1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(18,36));
});
test("floating with eyes above surface gets no underwater darkness",()=>{
 const {sc,viewer,interfaceGroup}=setup();
 viewer.document.elevation=-0.75;
 viewer.losHeight=0.4;
 assert.equal(getTokenWaterState(viewer.document).floating,true);
 assert.equal(getWaterRegionGlobalLightStates(sc,[viewer]).length,0);
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
 viewer.losHeight=-18;
 const states=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(states.length,1);
 assert.equal(states[0].depth,18);
 close(states[0].factor,lightAt(18,36));
 assert.equal(refreshWaterGlobalLighting(),1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(18,36));
});
test("darkness layer is inserted above emerged foreground sprites",()=>{
 const {viewer,interfaceGroup}=setup();
 viewer.document.elevation=-37.5;
 const overlay=new Container();
 overlay.name="pf1-waters-emerged-token-overlays";
 interfaceGroup.addChild(overlay);
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children[0],overlay);
 assert.equal(interfaceGroup.children[1].name,"pf1-waters-underwater-global-light");
});

test("controlled diver has priority over separate shallow vision sources",()=>{
 const {viewer,createViewer,interfaceGroup}=setup();
 viewer.document.elevation=-37.5;
 const sailor=createViewer(-1.5);
 canvas.effects.visionSources.set("sailor",{object:sailor,active:true});
 assert.equal(refreshWaterGlobalLighting(),1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(36,36));
});

test("darkvision and low-light vision are not confused",()=>{
 assert.equal(hasWaterDarkvision({document:{sight:{visionMode:"darkvision"}}}),true);
 assert.equal(hasWaterDarkvision({document:{sight:{visionMode:"pf1Darkvision"}}}),true);
 assert.equal(hasWaterDarkvision({document:{sight:{visionMode:"basic"}}}),false);
 assert.equal(hasWaterDarkvision({document:{sight:{visionMode:"lowlight"}}}),false);
 assert.equal(hasWaterDarkvision({document:{detectionModes:[
  {id:"darkvision",enabled:true,range:18}
 ]}}),true);
 assert.equal(hasWaterDarkvision({document:{detectionModes:[
  {id:"darkvision",enabled:false,range:18}
 ]}}),false);
});
test("perceived sunlight is gradual, with no arbitrary 12% visibility threshold",()=>{
 const physical=globalWaterLightFactor(150,36);
 assert.ok(physical>.05&&physical<.06);
 close(perceivedWaterGlobalLightFactor(physical,false),
   waterVisualLightResponse(physical));
 assert.equal(perceivedWaterGlobalLightFactor(physical,true),1);
 close(perceivedWaterGlobalLightFactor(.25,false),waterVisualLightResponse(.25));
 assert.ok(perceivedWaterGlobalLightFactor(.12,false)>0);
 assert.ok(perceivedWaterGlobalLightFactor(.01,false)>0);
 assert.equal(perceivedWaterGlobalLightFactor(0,false),0);
});
test("ordinary observer at -150m darkens progressively instead of abruptly blacking out",()=>{
 const {sc,region,viewer,interfaceGroup}=setup({limit:36});
 region.getFlag=(ns,key)=>ns==="pf1-waters"&&key==="waterRegion"
  ?{enabled:true,bodyId:"body",depth:1000,visibilityDepth:36}:undefined;
 viewer.document.elevation=-151.5;
 viewer.document.sight={visionMode:"basic"};
 const state=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(state.length,1);
 close(state[0].factor,lightAt(150,36));
 close(state[0].perceivedFactor,waterVisualLightResponse(lightAt(150,36)));
 close(state[0].darkness,alphaAt(150,36));
 assert.equal(refreshWaterGlobalLighting(),1);
 close(interfaceGroup.children.at(-1).children[0].alpha,alphaAt(150,36));
 assert.equal(interfaceGroup.children.at(-1).zIndex,1000000);
 const diagnostics=waterLightingDiagnostics();
 assert.equal(diagnostics.overlayAttached,true);
 assert.equal(diagnostics.overlayCount,1);
 close(diagnostics.regions[0].perceivedLightPercent,
   100*waterVisualLightResponse(lightAt(150,36)));
});
test("a darkvision observer at -150m is not visually blacked out",()=>{
 const {sc,region,viewer,interfaceGroup}=setup({limit:36});
 region.getFlag=(ns,key)=>ns==="pf1-waters"&&key==="waterRegion"
  ?{enabled:true,bodyId:"body",depth:1000,visibilityDepth:36}:undefined;
 viewer.document.elevation=-151.5;
 viewer.document.sight={visionMode:"darkvision"};
 const state=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(state[0].darkvision,true);
 assert.equal(state[0].perceivedFactor,1);
 assert.equal(state[0].darkness,0);
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
});
test("the water darkness layer renders above foreground replica images",()=>{
 const {viewer,interfaceGroup}=setup();
 viewer.document.elevation=-37.5;
 const replica=new Container();
 replica.name="pf1-waters-emerged-token-overlays";
 interfaceGroup.addChild(replica);
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children[0],replica);
 assert.equal(interfaceGroup.children[1].name,"pf1-waters-underwater-global-light");
});

test("regression: managed native Adjust Darkness Level no longer suppresses dynamic shading",()=>{
 const {region,viewer,interfaceGroup}=setup({limit:10});
 region.behaviors=[{
   type:"adjustDarknessLevel",disabled:false,
   flags:{"pf1-waters":{nativeWaterDepth:true}},
   getFlag(ns,key){return this.flags?.[ns]?.[key];}
 }];
 viewer.document.elevation=-11.5; // eyes at -10, physical sunlight 50%
 assert.equal(refreshWaterGlobalLighting(),1,
   "the managed native behavior must never disable the client overlay");
 assert.equal(interfaceGroup.children.length,1);
 const graphic=interfaceGroup.children[0].children[0];
 close(graphic.alpha,alphaAt(10,10));
 viewer.document.elevation=-21.5; // eyes at -20, 25% natural light
 assert.equal(refreshWaterGlobalLighting(),1);
 close(graphic.alpha,alphaAt(20,10));
 viewer.document.elevation=-51.5; // eyes at -50, just 5% sunlight
 assert.equal(refreshWaterGlobalLighting(),1);
 close(graphic.alpha,alphaAt(50,10));
 assert.ok(graphic.alpha<1,"no artificial 5x extinction");
 viewer.document.elevation=-.75; // eyes above the surface
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0,
   "the temporary layer must disappear on surfacing");
});

test("depth-only Token updates trigger a visible native-independent shading refresh",()=>{
 const {region,viewer,interfaceGroup}=setup({limit:10});
 region.behaviors=[{
   type:"adjustDarknessLevel",disabled:false,
   flags:{"pf1-waters":{nativeWaterDepth:true}}
 }];
 registerWaterGlobalLightingHooks();
 const onTokenUpdate=hooks.get("updateToken");
 assert.equal(typeof onTokenUpdate,"function");
 viewer.document.elevation=-11.5;
 onTokenUpdate(viewer.document,{elevation:-11.5});
 assert.equal(interfaceGroup.children.length,1);
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(10,10));
 viewer.document.elevation=-21.5;
 onTokenUpdate(viewer.document,{elevation:-21.5});
 close(interfaceGroup.children[0].children[0].alpha,alphaAt(20,10));
});

test("darkvision does not receive opaque black postprocessing in deep water",()=>{
 const {region,viewer,interfaceGroup}=setup({limit:10});
 region.behaviors=[{
   type:"adjustDarknessLevel",disabled:false,
   flags:{"pf1-waters":{nativeWaterDepth:true}}
 }];
 viewer.document.sight={visionMode:"darkvision"};
 viewer.document.elevation=-151.5;
 assert.equal(refreshWaterGlobalLighting(),0,
   "PF1 darkvision stays under the native vision engine instead of being blacked out");
 assert.equal(interfaceGroup.children.length,0);
});
