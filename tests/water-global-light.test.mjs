import test from "node:test";
import assert from "node:assert/strict";
import {
  hasSceneGlobalIllumination, globalWaterLightFactor,
  getWaterRegionGlobalLightStates,refreshWaterGlobalLighting,
  registerWaterGlobalLightingHooks
} from "../scripts/water-global-light.mjs";

class Container {
  constructor(){this.children=[];this.parent=null;this.destroyed=false;}
  addChild(x){this.children.push(x);x.parent=this;return x;}
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

function setup({light=true,limit=36}={}) {
 const sc={id:"sc",grid:{size:100,distance:1.5,units:"m"},
  environment:{globalLight:{enabled:light}},
  regions:[],tokens:[]};
 const region={id:"lake",parent:sc,elevation:0,
  triangulation:{
   vertices:new Float32Array([0,0,200,0,200,200,0,200]),
   indices:new Uint16Array([0,1,2,0,2,3])
  },
  getFlag(ns,key){return ns==="pf1-waters"&&key==="waterRegion"?
    {enabled:true,surface:0,depth:200,visibilityDepth:limit}:undefined;},
  testPoint({x,y}){return x>=0&&x<200&&y>=0&&y<200;}
 };
 sc.regions.push(region);
 const createViewer=(z,x=10)=>({document:{
  id:"viewer",parent:sc,x,y:10,width:1,height:1,elevation:z,
  movementAction:"swim",getFlag(){return undefined;}
 }});
 const viewer=createViewer(-19.5);
 const primary=new Container();
 globalThis.canvas={ready:true,scene:sc,primary,
  tokens:{controlled:[viewer]},effects:{visionSources:new Map()}};
 return {sc,region,viewer,primary,createViewer};
}
test("v13 global-light setting gates the effect",()=>{
 assert.equal(hasSceneGlobalIllumination({environment:{globalLight:{enabled:true}}}),true);
 assert.equal(hasSceneGlobalIllumination({environment:{globalLight:{enabled:false}}}),false);
 assert.equal(hasSceneGlobalIllumination({}),false);
});
test("linear falloff reaches full darkness at twice visibility depth",()=>{
 assert.equal(globalWaterLightFactor(0,36),1);
 assert.equal(globalWaterLightFactor(18,36),.75);
 assert.equal(globalWaterLightFactor(36,36),.5);
 assert.equal(globalWaterLightFactor(54,36),.25);
 assert.equal(globalWaterLightFactor(72,36),0);
 assert.equal(globalWaterLightFactor(1000,36),0);
 assert.equal(globalWaterLightFactor(120,120),.5);
 assert.equal(globalWaterLightFactor(240,120),0);
 assert.equal(globalWaterLightFactor(0,0),1);
 assert.equal(globalWaterLightFactor(.01,0),0);
});
test("observer depth and custom water visibility determine attenuation",()=>{
 const {sc}=setup({limit:36});
 const state=getWaterRegionGlobalLightStates(sc,canvas.tokens.controlled);
 assert.equal(state.length,1);
 assert.equal(state[0].depth,18);
 assert.equal(state[0].factor,.75);
 assert.equal(state[0].cutoff,72);
});
test("outside or no-global-light scenes show no underwater shading",()=>{
 const {sc,viewer}=setup();
 viewer.document.elevation=3;
 assert.equal(getWaterRegionGlobalLightStates(sc,[viewer]).length,0);
 const x=setup({light:false});
 assert.equal(getWaterRegionGlobalLightStates(x.sc,canvas.tokens.controlled).length,0);
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(canvas.primary.children.length,0);
});
test("multiple active underwater viewers share the least dark view",()=>{
 const {sc,viewer,createViewer}=setup();
 const shallow=createViewer(-1.5);
 const result=getWaterRegionGlobalLightStates(sc,[viewer,shallow]);
 assert.equal(result.length,1);
 assert.equal(result[0].factor,1);
});
test("graphics matches Region triangles, fades and cleans up on exit",()=>{
 const {viewer,primary}=setup();
 viewer.document.elevation=-37.5; // top -36
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(primary.children.length,1);
 const gfx=primary.children[0].children[0];
 assert.deepEqual(gfx.polygons,[
  [0,0,200,0,200,200],[0,0,200,200,0,200]
 ]);
 assert.equal(gfx.alpha,.5);
 viewer.document.elevation=-73.5; // top -72
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(gfx.alpha,1);
 viewer.document.elevation=-1.5;
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(primary.children.length,0);
 assert.equal(gfx.destroyed,true);
});
test("turning global light off removes local overlays without changing scene",()=>{
 const {sc,viewer,primary}=setup();
 viewer.document.elevation=-37.5;
 assert.equal(refreshWaterGlobalLighting(),1);
 sc.environment.globalLight.enabled=false;
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(primary.children.length,0);
 assert.equal(sc.environment.globalLight.enabled,false);
});
test("GM without controlled token gets no underwater shading",()=>{
 const {viewer,primary}=setup();
 viewer.document.elevation=-37.5;
 game.user.isGM=true;
 canvas.tokens.controlled=[];
 assert.equal(refreshWaterGlobalLighting(),0);
 assert.equal(primary.children.length,0);
 game.user.isGM=false;
 canvas.effects.visionSources.set("sight",{object:viewer,active:true});
 assert.equal(refreshWaterGlobalLighting(),1);
 assert.equal(primary.children.length,1);
});
test("underwater illumination hooks registered",()=>{
 registerWaterGlobalLightingHooks();
 for(const name of ["canvasReady","updateToken","updateRegion","updateScene","canvasTearDown"])
  assert.equal(typeof hooks.get(name),"function");
});
