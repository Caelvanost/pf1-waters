import test from "node:test";
import assert from "node:assert/strict";
import { getTokenWaterState } from "../scripts/water-state.mjs";
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
  regions:[],tokens:[]};
 const region={id:"lake",parent:sc,elevation:0,
  triangulation:{
   vertices:new Float32Array([0,0,200,0,200,200,0,200]),
   indices:new Uint16Array([0,1,2,0,2,3])
  },
  getFlag(ns,key){return ns==="pf1-waters"&&key==="waterRegion"?
    {enabled:true,surface:0,depth:200,visibilityDepth:limit,
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
test("sunlight milestones: 50% at 1×, 25% at 2×, 5% at 5×, 0% at 20×",()=>{
 // The curve is piecewise linear, continuous and never negative.
 assert.equal(globalWaterLightFactor(0,36),1);
 assert.equal(globalWaterLightFactor(18,36),.75);
 assert.equal(globalWaterLightFactor(36,36),.5);
 assert.equal(globalWaterLightFactor(54,36),.375);
 assert.equal(globalWaterLightFactor(72,36),.25);
 assert.ok(Math.abs(globalWaterLightFactor(126,36)-.15)<1e-12);
 assert.ok(Math.abs(globalWaterLightFactor(180,36)-.05)<1e-12);
 assert.ok(Math.abs(globalWaterLightFactor(450,36)-.025)<1e-12);
 assert.equal(globalWaterLightFactor(720,36),0);
 assert.equal(globalWaterLightFactor(1000,36),0);
 // Feet-based Regions use their configured 120-foot distance, not metres.
 assert.equal(globalWaterLightFactor(120,120),.5);
 assert.equal(globalWaterLightFactor(180,120),.375);
 assert.equal(globalWaterLightFactor(240,120),.25);
 assert.ok(Math.abs(globalWaterLightFactor(600,120)-.05)<1e-12);
 assert.equal(globalWaterLightFactor(2400,120),0);
 assert.equal(globalWaterLightFactor(3000,120),0);
 assert.equal(globalWaterLightFactor(0,0),1);
 assert.equal(globalWaterLightFactor(.01,0),0);
 assert.equal(globalWaterLightFactor(-10,36),1);
 assert.equal(globalWaterLightFactor(10,-1),1);
});
test("observer depth and custom water visibility determine attenuation",()=>{
 const {sc}=setup({limit:36});
 const state=getWaterRegionGlobalLightStates(sc,canvas.tokens.controlled);
 assert.equal(state.length,1);
 assert.equal(state[0].depth,18);
 assert.equal(state[0].factor,.75);
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
 assert.equal(result[0].factor,.75,
   "only the observer with submerged eyes contributes to water shading");
});
test("two genuinely submerged viewers use their shallowest common lighting",()=>{
 const {sc,viewer,createViewer}=setup();
 const shallow=createViewer(-10.5); // eye at -9m
 const result=getWaterRegionGlobalLightStates(sc,[viewer,shallow]);
 assert.equal(result.length,1);
 assert.equal(result[0].depth,9);
 assert.equal(result[0].factor,.875);
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
 assert.equal(gfx.alpha,.5);
 viewer.document.elevation=-73.5; // top -72
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(gfx.alpha,.75,"25% sunlight remains at the second milestone");
 viewer.document.elevation=-181.5; // top -180 = 5× visibility
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(gfx.alpha,1,
   "5% of physical sunlight cannot illuminate an observer with normal sight");
 viewer.document.elevation=-201.5; // observer's volume extends beyond Region depth
 assert.equal(refreshWaterGlobalLighting(),0,"outside a Region: no attenuation overlay");
 assert.equal(interfaceGroup.children.length,0);
 assert.equal(gfx.destroyed,true);
 viewer.document.elevation=-1.5;
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
});
test("elevation-banded native darkness suppresses the legacy black overlay",()=>{
 const {region,viewer,interfaceGroup}=setup();
 region.getFlag=(namespace,key)=>
   namespace==="pf1-waters"&&key==="waterRegion"
   ? {enabled:true,surface:0,depth:200,visibilityDepth:36,
      sunlightHalfDepth:5,darknessBands:true,darknessBandCount:12}
   : undefined;
 viewer.document.elevation=-19.5;
 assert.equal(getWaterRegionGlobalLightStates(canvas.scene,[viewer]).length,1);
 assert.equal(refreshWaterGlobalLighting(),0,
   "native OVERRIDE regions must never receive a second darkness overlay");
 assert.equal(interfaceGroup.children.length,0);
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

test("explicit Region visibility scales every milestone up to full extinction",()=>{
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
 assert.ok(Math.abs(states[0].factor-.05)<1e-12);
 viewer.document.elevation=-201.5; // volume below finite Region; calculation still reaches 0
 assert.equal(globalWaterLightFactor(200,10),0);
});
test("a non-global-light Scene never creates attenuation",()=>{
 const {sc,viewer,interfaceGroup}=setup({light:false});
 viewer.document.elevation=-90;
 assert.equal(getWaterRegionGlobalLightStates(sc,[viewer]).length,0);
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(interfaceGroup.children.length,0);
});

test("a deep Region removes the last 5% of global sunlight at 20× distance",()=>{
 const {sc,region,viewer,interfaceGroup}=setup({limit:10});
 region.getFlag=(ns,key)=>ns==="pf1-waters"&&key==="waterRegion"
   ?{enabled:true,surface:0,depth:1000,visibilityDepth:10}:undefined;
 viewer.document.elevation=-201.5; // eyes at top -200m
 const states=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(states.length,1);
 assert.equal(states[0].factor,0);
 assert.equal(states[0].darkness,1);
 assert.equal(states[0].cutoff,200);
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children[0].children[0].alpha,1);
 viewer.document.elevation=-301.5;
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children[0].children[0].alpha,1);
});

test("darkening is drawn on the visible interface pass, not the cached primary",()=>{
 const {viewer,primary,interfaceGroup}=setup();
 viewer.document.elevation=-19.5; // eyes 18m under water
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(primary.children.length,0,
   "primary cached canvas must not receive the darkness overlay");
 assert.equal(interfaceGroup.children.length,1);
 assert.equal(interfaceGroup.children[0].children[0].alpha,.25);
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
 assert.equal(states[0].factor,.75);
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children[0].children[0].alpha,.25);
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
 assert.equal(interfaceGroup.children[0].children[0].alpha,.5,
   "selected diver at 36m sees 50% light despite shallow sight source");
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
test("10.6% physical sunlight at 150m does not give unaided sight",()=>{
 const physical=globalWaterLightFactor(150,36);
 assert.ok(physical>.1&&physical<.12);
 assert.equal(perceivedWaterGlobalLightFactor(physical,false),0);
 assert.equal(perceivedWaterGlobalLightFactor(physical,true),1);
 assert.equal(perceivedWaterGlobalLightFactor(.25,false),.25);
 assert.ok(perceivedWaterGlobalLightFactor(.15,false)>0);
 assert.ok(perceivedWaterGlobalLightFactor(.15,false)<.15);
 assert.equal(perceivedWaterGlobalLightFactor(.12,false),0);
 assert.equal(perceivedWaterGlobalLightFactor(0,false),0);
});
test("selected ordinary-sighted observer at -150m gets a black screen",()=>{
 const {sc,region,viewer,interfaceGroup}=setup({limit:36});
 region.getFlag=(ns,key)=>ns==="pf1-waters"&&key==="waterRegion"
  ?{enabled:true,surface:0,depth:1000,visibilityDepth:36}:undefined;
 viewer.document.elevation=-151.5;
 viewer.document.sight={visionMode:"basic"};
 const state=getWaterRegionGlobalLightStates(sc,[viewer]);
 assert.equal(state.length,1);
 assert.ok(state[0].factor>.1);
 assert.equal(state[0].perceivedFactor,0);
 assert.equal(state[0].darkness,1);
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(interfaceGroup.children.at(-1).children[0].alpha,1);
 assert.equal(interfaceGroup.children.at(-1).zIndex,1000000);
 const diagnostics=waterLightingDiagnostics();
 assert.equal(diagnostics.overlayAttached,true);
 assert.equal(diagnostics.overlayCount,1);
 assert.equal(diagnostics.regions[0].perceivedLightPercent,0);
});
test("a darkvision observer at -150m is not visually blacked out",()=>{
 const {sc,region,viewer,interfaceGroup}=setup({limit:36});
 region.getFlag=(ns,key)=>ns==="pf1-waters"&&key==="waterRegion"
  ?{enabled:true,surface:0,depth:1000,visibilityDepth:36}:undefined;
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
