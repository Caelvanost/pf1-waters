import test from "node:test";
import assert from "node:assert/strict";
import { getTokenWaterState } from "../scripts/water-state.mjs";
import {
  calculateWaterVisualElevation, getTokenWaterVisualElevation,
  calculateUnderwaterVisualOpacity, getTokenWaterVisualDisplay,
  refreshTokenWaterVisualDepth, refreshSceneWaterVisualDepth,
  surfaceContainsTokenCenter, hasExteriorWaterViewer,
  canSeeWaterTokenFromExterior, hasInteriorWaterViewer,
  canSeeWaterTokenFromInterior, getWaterObserverEyeElevation,
  isWaterObserverSubmerged
} from "../scripts/water-visual-depth.mjs";

class Point{
  constructor(x=0,y=0){this.x=x;this.y=y;}
  set(x,y){this.x=x;this.y=y??x;}
}
class Container{
  constructor(){this.children=[];this.parent=null;this.destroyed=false;}
  addChild(child){child.parent=this;this.children.push(child);return child;}
  destroy(){this.destroyed=true;}
}
class Sprite{
  constructor(texture){
    this.texture=texture;this.anchor=new Point(0.5,0.5);
    this.position=new Point();this.scale=new Point(1,1);this.pivot=new Point();
    this.alpha=1;this.visible=true;this.destroyed=false;
  }
  destroy(){this.destroyed=true;}
}
globalThis.PIXI={Container,Sprite};
globalThis.game={
  settings:{get:()=>true},user:{id:"gm",isGM:true}
};
const ticker={fn:null,add(fn){this.fn=fn;},remove(fn){if(this.fn===fn)this.fn=null;}};
globalThis.canvas={
  ready:true,scene:null,primary:{renderDirty:false},
  interface:new Container(),tokens:{placeables:[]},app:{ticker}
};

function makeScene(){
 const scene={id:"water-test",grid:{size:100,distance:1.5,units:"m"},
   regions:[],tiles:[],drawings:[]};
 const region={id:"r1",parent:scene,name:"Lac",elevation:0,
   getFlag(ns,key){
     if(ns==="pf1-waters"&&key==="waterRegion")
       return {enabled:true,surface:0,depth:this.depth??10,visibilityDepth:this.visibilityDepth??null};
     return undefined;
   },
   testPoint({x,y}){return x>=0&&x<200&&y>=0&&y<200;}
 };
 scene.regions.push(region);return {scene,region};
}
function makeVisual(scene,type="Tile",opts={}){
 const doc={documentName:type,id:opts.id??(type+scene.tiles.length),
   parent:scene,x:opts.x??0,y:opts.y??0,
   width:opts.width??200,height:opts.height??200,
   elevation:opts.elevation??0,rotation:0,
   flags:{"pf1-waters":{waterSurface:{
     enabled:opts.enabled!==false,regionId:opts.regionId??"r1",
     syncElevation:true,visibilityDepth:opts.visibilityDepth??3
   }}},
   getFlag(ns,key){return this.flags[ns]?.[key];}
 };
 (type==="Tile"?scene.tiles:scene.drawings).push(doc);
 return doc;
}
function makeToken(scene,elevation,options={}){
 const doc={parent:scene,id:"token",name:"Pirate",elevation,
   x:10,y:10,width:1,height:1,alpha:1,
   movementAction:options.fly?"fly":"swim",
   getFlag(){return undefined;}};
 const texture={id:"token-art"};
 const mesh={texture,elevation,alpha:1,
   anchor:new Point(0.5,0.5),position:new Point(60,60),
   scale:new Point(1,1),pivot:new Point(),rotation:0,width:100,height:100};
 const token={document:doc,mesh,visible:true,center:{x:60,y:60}};
 doc.object=token;canvas.scene=scene;canvas.tokens.placeables=[token];
 return token;
}

test("pure compositing decision leaves native elevation unchanged",()=>{
 const base={inWater:true,flying:false,tokenBottom:-0.75,
   tokenTop:0.75,surface:0,intersectsSurface:true};
 assert.equal(calculateWaterVisualElevation(base,[0]),0.001);
 assert.equal(calculateWaterVisualElevation({...base,tokenBottom:-1.5,
   tokenTop:0,intersectsSurface:false},[0]),null);
 assert.equal(calculateWaterVisualElevation({...base,flying:true},[0]),null);
 assert.equal(calculateWaterVisualElevation(base,[]),null);
});
test("fully submerged opacity fades only near configured depth limit",()=>{
 assert.equal(calculateUnderwaterVisualOpacity(0,3),1);
 assert.equal(calculateUnderwaterVisualOpacity(1,3),1);
 assert.equal(calculateUnderwaterVisualOpacity(2.1,3),1);
 assert.ok(calculateUnderwaterVisualOpacity(2.55,3)<0.55);
 assert.equal(calculateUnderwaterVisualOpacity(3,3),0);
 assert.equal(calculateUnderwaterVisualOpacity(5,3),0);
 assert.equal(calculateUnderwaterVisualOpacity(0,0),0);
});
test("emerged token has one opaque image copy above linked water and no ghost",()=>{
 const {scene}=makeScene();makeVisual(scene);
 const token=makeToken(scene,-0.75);
 assert.equal(getTokenWaterVisualElevation(token),0.001);
 assert.equal(getTokenWaterVisualDisplay(token).mode,"emerged");
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.document.elevation,-0.75);
 assert.equal(token.mesh.elevation,-0.75);
 assert.equal(token.mesh.alpha,0);
 assert.equal(canvas.interface.children.at(-1).children.length,1);
 const image=canvas.interface.children.at(-1).children[0];
 assert.equal(image.alpha,1);
 assert.equal(image.texture,token.mesh.texture);
 token.mesh.position.set(80,85);
 ticker.fn();
 assert.equal(image.position.x,80);
 assert.equal(image.position.y,85);
 assert.equal(image.alpha,1,"native hidden mesh must not hide visual copy");
 assert.equal(refreshTokenWaterVisualDepth(token),false);
});
test("full immersion restores native image then fades it below transparent tile",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=3;makeVisual(scene);
 const token=makeToken(scene,-0.75);
 refreshTokenWaterVisualDepth(token);
 token.document.elevation=-1.5;
 assert.equal(getTokenWaterVisualDisplay(token).mode,"submerged");
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.mesh.alpha,1,"top at surface, still visible");
 token.document.elevation=-4.5;
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.mesh.alpha,0,"top beyond 3m, hidden");
 token.document.x=400;token.center={x:450,y:60};
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.mesh.alpha,1,"leaving linked Region restores opacity");
});
test("transparent Tile alpha hit-test never prevents a half-emerged token from appearing in front",()=>{
 const {scene}=makeScene();
 const tile=makeVisual(scene,"Tile");
 tile.object={
   mesh:{containsCanvasPoint(){return false;}},
   bounds:{contains(){return false;}}
 };
 const token=makeToken(scene,-1.05);
 assert.equal(token.document.elevation,-1.05);
 const water=getTokenWaterVisualDisplay(token);
 assert.equal(water.mode,"emerged","1.5m token extends 0.45m above 0m water");
 assert.equal(surfaceContainsTokenCenter(tile,token),true,
   "Water Tile footprint ignores transparent PNG pixel alpha");
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 const sprite=canvas.interface.children.at(-1).children.at(-1);
 assert.equal(sprite.alpha,1);
 assert.equal(sprite.visible,true);
 assert.equal(token.mesh.alpha,0,"no ghost behind the translucent Tile");
 assert.equal(token.document.elevation,-1.05,"no gameplay elevation changes");
});

test("transparent Tile hit test cannot extend water surface beyond geometry",()=>{
 const {scene}=makeScene();
 const tile=makeVisual(scene,"Tile",{x:300,y:300,width:100,height:100});
 tile.object={mesh:{containsCanvasPoint(){return true;}}};
 const token=makeToken(scene,-1.05);
 assert.equal(surfaceContainsTokenCenter(tile,token),false);
 assert.equal(getTokenWaterVisualDisplay(token),null);
 assert.equal(refreshTokenWaterVisualDepth(token),false);
 assert.equal(token.mesh.alpha,1);
});

test("emerged overlay position accounts for distinct Canvas group transforms",()=>{
 const {scene}=makeScene();makeVisual(scene);
 const token=makeToken(scene,-1.05);
 token.mesh.getGlobalPosition=()=>({x:920,y:720});
 // canvas.interface is not always in the same space as the native mesh.
 canvas.interface.toLocal=point=>({x:point.x-700,y:point.y-500});
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 const overlay=canvas.interface.children.at(-1);
 overlay.toLocal=canvas.interface.toLocal;
 // A subsequent position refresh should take global coordinates.
 refreshTokenWaterVisualDepth(token);
 const sprite=overlay.children.at(-1);
 assert.equal(sprite.position.x,220);
 assert.equal(sprite.position.y,220);
 assert.equal(sprite.alpha,1);
});

test("Drawing works like a linked Tile",()=>{
 const {scene}=makeScene();
 const drawing=makeVisual(scene,"Drawing");
 const token=makeToken(scene,-0.75);
 assert.equal(surfaceContainsTokenCenter(drawing,token),true);
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.mesh.alpha,0);
});
test("no effect for missing link or outside visual footprint",()=>{
 const {scene}=makeScene();
 makeVisual(scene,"Tile",{regionId:"missing"});
 const token=makeToken(scene,-0.75);
 assert.equal(getTokenWaterVisualDisplay(token),null);
 assert.equal(refreshTokenWaterVisualDepth(token),false);
 assert.equal(token.mesh.alpha,1);
});
test("wrong visual footprint does not alter token depth rendering",()=>{
 const {scene}=makeScene();
 makeVisual(scene,"Tile",{x:350,y:350,width:100,height:100});
 const token=makeToken(scene,-0.75);
 assert.equal(getTokenWaterVisualDisplay(token),null);
 assert.equal(refreshTokenWaterVisualDepth(token),false);
});
test("default 36m Region depth takes precedence over old surface depth limits",()=>{
 const {scene}=makeScene();
 makeVisual(scene,"Tile",{visibilityDepth:1});
 makeVisual(scene,"Drawing",{visibilityDepth:5});
 const token=makeToken(scene,-2);
 const state=getTokenWaterVisualDisplay(token);
 assert.equal(state.mode,"submerged");
 assert.equal(state.maximumDepth,36);
 assert.equal(state.opacity,1);
});
test("disabling copy restores native image and keeps token's gameplay Z",()=>{
 const {scene}=makeScene();makeVisual(scene);
 const token=makeToken(scene,-0.75);
 refreshTokenWaterVisualDepth(token);
 game.settings.get=()=>false;
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.mesh.alpha,1);
 assert.equal(token.document.elevation,-0.75);
 game.settings.get=()=>true;
});
test("bulk refresh follows changes without moving TokenDocument elevation",()=>{
 const {scene}=makeScene();makeVisual(scene);
 const token=makeToken(scene,-0.75);
 assert.equal(refreshSceneWaterVisualDepth(),1);
 assert.equal(refreshSceneWaterVisualDepth(),0);
 token.document.elevation=-1.5;
 assert.equal(refreshSceneWaterVisualDepth(),true?1:0);
});
test("actual visual shape can reject a token inside bounding box",()=>{
 const {scene}=makeScene();
 const drawing=makeVisual(scene,"Drawing");
 drawing.object={shape:{containsCanvasPoint:()=>false}};
 const token=makeToken(scene,-0.75);
 assert.equal(surfaceContainsTokenCenter(drawing,token),false);
 assert.equal(refreshTokenWaterVisualDepth(token),false);
});

test("Region visibility depth overrides multiple Tile and Drawing settings",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=1.2;
 makeVisual(scene,"Tile",{visibilityDepth:5});
 makeVisual(scene,"Drawing",{visibilityDepth:7});
 const token=makeToken(scene,-2.5); // top = -1; inside Region limit
 assert.equal(getTokenWaterVisualDisplay(token).maximumDepth,1.2);
 assert.ok(getTokenWaterVisualDisplay(token).opacity>0);
 token.document.elevation=-2.7; // top = -1.2, exactly hidden
 assert.equal(getTokenWaterVisualDisplay(token).opacity,0);
 token.document.elevation=-1;
 assert.equal(getTokenWaterVisualDisplay(token).opacity,1);
});
test("exterior sailor sees emergent token via Foundry elevated LOS when base is invisible",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=3;makeVisual(scene);
 const sailor={document:{id:"sailor",parent:scene,
   elevation:5,height:1,width:1},losHeight:6,controlled:true};
 const token=makeToken(scene,-0.75);
 token.isVisible=false;token.visible=false;token.mesh.visible=false;
 canvas.tokens.controlled=[sailor];
 canvas.visibility={testVisibility(point,options){
   assert.equal(point.x,60);
   assert.ok(point.elevation>0,"probe above the waterline");
   assert.equal(options.object,token);
   return true;
 }};
 game.user.isGM=false;
 assert.equal(hasExteriorWaterViewer(0),true);
 assert.equal(canSeeWaterTokenFromExterior(token),true);
 assert.equal(refreshTokenWaterVisualDepth(token),true);
 assert.equal(token.visible,true);
 assert.equal(token.mesh.visible,true);
 assert.equal(token.mesh.alpha,0,"hide native behind emerged overlay");
 const overlay=canvas.interface.children.at(-1).children.at(-1);
 assert.equal(overlay.visible,true);
 assert.equal(overlay.alpha,1);
 token.document.elevation=-5; // below visibility limit
 refreshTokenWaterVisualDepth(token);
 assert.equal(token.visible,false,"must restore native visibility underwater");
 assert.equal(token.mesh.visible,false);
 assert.equal(token.mesh.alpha,0,"too deep to see: native sprite is correctly faded out");
 token.document.x=400;token.center={x:450,y:60};
 refreshTokenWaterVisualDepth(token);
 assert.equal(token.mesh.alpha,1,"leaving Region restores native alpha");
 game.user.isGM=true;
 canvas.tokens.controlled=[];delete canvas.visibility;
});
test("submerged target is displayed beneath Tile if top is within Region range and LOS passes",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=2;makeVisual(scene);
 const viewer={document:{parent:scene,elevation:3,height:1},losHeight:4};
 const token=makeToken(scene,-2); // top -0.5 m
 token.isVisible=false;token.visible=false;token.mesh.visible=false;
 canvas.tokens.controlled=[viewer];
 canvas.visibility={testVisibility(point){return point.elevation>0;}};
 game.user.isGM=false;
 assert.equal(getTokenWaterVisualDisplay(token).mode,"submerged");
 assert.equal(canSeeWaterTokenFromExterior(token),true);
 refreshTokenWaterVisualDepth(token);
 assert.equal(token.visible,true);
 assert.equal(token.mesh.visible,true);
 assert.equal(token.mesh.alpha,1,"the native primary mesh stays beneath water");
 assert.equal(canvas.interface.children.at(-1).children.filter(
   sprite=>!sprite.destroyed && sprite.texture===token.mesh.texture
 ).length,0,"fully submerged target has no foreground copy");
 token.document.elevation=-3.6; // top -2.1 m
 refreshTokenWaterVisualDepth(token);
 assert.equal(token.visible,false,"over-depth tokens never acquire exterior visibility");
 assert.equal(token.mesh.visible,false);
 game.user.isGM=true;
 canvas.tokens.controlled=[];delete canvas.visibility;
});
test("an underwater observer sees a floating creature while blocked LOS still prevents it",()=>{
 const {scene}=makeScene();makeVisual(scene);
 const target=makeToken(scene,-0.75);
 target.isVisible=false;target.visible=false;target.mesh.visible=false;
 const viewer={document:{parent:scene,elevation:-4,height:1},losHeight:-3};
 canvas.tokens.controlled=[viewer];
 canvas.visibility={testVisibility(){return true;}};
 game.user.isGM=false;
 assert.equal(hasExteriorWaterViewer(0),false);
 assert.equal(canSeeWaterTokenFromExterior(target),false);
 assert.equal(canSeeWaterTokenFromInterior(target),true);
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,true,"an observer in the same water Region sees the floating creature");
 viewer.losHeight=5;
 canvas.visibility={testVisibility(){return false;}}; // wall or darkness
 assert.equal(hasExteriorWaterViewer(0),true);
 assert.equal(canSeeWaterTokenFromExterior(target),false);
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,false);
 target.document.hidden=true;
 canvas.visibility={testVisibility(){return true;}};
 assert.equal(canSeeWaterTokenFromExterior(target),false);
 game.user.isGM=true;
 canvas.tokens.controlled=[];delete canvas.visibility;
});

test("an unset Region threshold uses 36m from the creature's TOP",()=>{
 const {scene,region}=makeScene();
 region.getFlag=(_ns,key)=>key==="waterRegion"?
   {enabled:true,surface:0,depth:200}:undefined;
 makeVisual(scene,"Tile",{visibilityDepth:3});
 const token=makeToken(scene,-37);
 let state=getTokenWaterVisualDisplay(token);
 assert.equal(state.maximumDepth,36);
 assert.ok(state.opacity>0&&state.opacity<1);
 token.document.elevation=-37.5;
 state=getTokenWaterVisualDisplay(token);
 assert.equal(state.maximumDepth,36);
 assert.equal(state.opacity,0);
});


function underwaterViewer(scene, {x=10,y=10,elevation=-4}={}) {
  return {
    document:{
      id:"underwater-observer",
      parent:scene,x,y,width:1,height:1,elevation,
      movementAction:"swim",getFlag(){return undefined;}
    },
    losHeight:elevation+1.1
  };
}
function resetViewerTests(){
  game.user.isGM=true;
  canvas.tokens.controlled=[];
  delete canvas.effects;
  delete canvas.visibility;
}

test("two tokens in the same water Region remain fully visible at any depth",()=>{
  const {scene,region}=makeScene();region.visibilityDepth=1.5;
  makeVisual(scene,"Tile");
  const token=makeToken(scene,-7);
  token.isVisible=false;token.visible=false;token.mesh.visible=false;
  canvas.tokens.controlled=[underwaterViewer(scene)];
  canvas.visibility={testVisibility(point,{object}){
    assert.equal(object,token);
    assert.ok(point.elevation < 0, "test submerged target point, not the waterline");
    return true;
  }};
  game.user.isGM=false;
  const limit=getTokenWaterVisualDisplay(token);
  assert.equal(limit.mode,"submerged");
  assert.equal(limit.opacity,0,"an exterior observer is beyond its range");
  assert.equal(hasInteriorWaterViewer(getTokenWaterState(token.document)),true);
  assert.equal(canSeeWaterTokenFromInterior(token),true);
  refreshTokenWaterVisualDepth(token);
  assert.equal(token.visible,true);
  assert.equal(token.mesh.visible,true);
  assert.equal(token.mesh.alpha,1,"no artificial fade for interior viewer");
  resetViewerTests();
});

test("switching from interior observer to exterior restores water depth limit",()=>{
  const {scene,region}=makeScene();region.visibilityDepth=2;
  makeVisual(scene);
  const token=makeToken(scene,-6);
  token.isVisible=false;token.visible=false;token.mesh.visible=false;
  const viewer=underwaterViewer(scene);
  canvas.tokens.controlled=[viewer];
  canvas.visibility={testVisibility(){return true;}};
  game.user.isGM=false;
  refreshTokenWaterVisualDepth(token);
  assert.equal(token.mesh.alpha,1);
  assert.equal(token.visible,true);
  viewer.document.elevation=5;viewer.losHeight=6;
  refreshSceneWaterVisualDepth();
  assert.equal(hasInteriorWaterViewer(getTokenWaterState(token.document)),false);
  assert.equal(token.mesh.alpha,0);
  assert.equal(token.visible,false,
    "an outside observer cannot see a deeply submerged token");
  resetViewerTests();
});

test("interior visibility never bypasses walls, fog, or hidden-token rules",()=>{
  const {scene,region}=makeScene();region.visibilityDepth=2;
  makeVisual(scene);
  const token=makeToken(scene,-6);
  token.isVisible=false;token.visible=false;token.mesh.visible=false;
  canvas.tokens.controlled=[underwaterViewer(scene)];
  canvas.visibility={testVisibility(){return false;}};
  game.user.isGM=false;
  assert.equal(hasInteriorWaterViewer(getTokenWaterState(token.document)),true);
  assert.equal(canSeeWaterTokenFromInterior(token),false);
  refreshTokenWaterVisualDepth(token);
  assert.equal(token.mesh.alpha,0);
  assert.equal(token.visible,false);
  token.document.hidden=true;
  canvas.visibility={testVisibility(){return true;}};
  assert.equal(canSeeWaterTokenFromInterior(token),false);
  resetViewerTests();
});

test("being inside Region footprint above water never grants underwater vision",()=>{
  const {scene,region}=makeScene();region.visibilityDepth=2;
  makeVisual(scene);
  const token=makeToken(scene,-6);
  token.isVisible=false;token.visible=false;token.mesh.visible=false;
  canvas.tokens.controlled=[underwaterViewer(scene,{elevation:5})];
  canvas.visibility={testVisibility(){return true;}};
  game.user.isGM=false;
  assert.equal(hasInteriorWaterViewer(getTokenWaterState(token.document)),false);
  refreshTokenWaterVisualDepth(token);
  assert.equal(token.mesh.alpha,0);
  assert.equal(token.visible,false);
  resetViewerTests();
});

test("underwater observers in different Regions of one body share interior visibility",()=>{
  const {scene,region}=makeScene();
  scene.flags={"pf1-waters":{waterBodies:[{id:"bay",name:"Baie",surface:0}]}};
  scene.getFlag=(ns,key)=>scene.flags?.[ns]?.[key];
  const original=region.getFlag.bind(region);
  region.getFlag=(ns,key)=>{
    const value=original(ns,key);
    return value&&ns==="pf1-waters"&&key==="waterRegion"
      ?{...value,bodyId:"bay"}:value;
  };
  const distant={
    id:"r2",parent:scene,elevation:{bottom:-12,top:0},
    getFlag(ns,key){return ns==="pf1-waters"&&key==="waterRegion"
      ?{enabled:true,bodyId:"bay",surface:0,depth:12,visibilityDepth:2}:undefined;},
    testPoint({x,y,elevation}){return x>=200&&x<400&&y>=0&&y<200&&
      elevation>=-12&&elevation<=0;}
  };
  scene.regions.push(distant);
  makeVisual(scene);
  const target=makeToken(scene,-6);
  target.isVisible=false;target.visible=false;target.mesh.visible=false;
  canvas.tokens.controlled=[underwaterViewer(scene,{x:250,y:10,elevation:-4})];
  canvas.visibility={testVisibility(){return true;}};
  game.user.isGM=false;
  assert.equal(hasInteriorWaterViewer(getTokenWaterState(target.document)),true);
  assert.equal(canSeeWaterTokenFromInterior(target),true);
  refreshTokenWaterVisualDepth(target);
  assert.equal(target.visible,true);
  assert.equal(target.mesh.alpha,1);
  resetViewerTests();
});
test("underwater observer in a different water Region never bypasses range",()=>{
  const {scene,region}=makeScene();region.visibilityDepth=2;
  makeVisual(scene);
  const other={id:"r2",parent:scene,elevation:0,
    getFlag(ns,key){return ns==="pf1-waters"&&key==="waterRegion"
      ?{enabled:true,surface:0,depth:10,visibilityDepth:2}:undefined;},
    testPoint({x,y}){return x>=200&&x<400&&y>=0&&y<200;}
  };
  scene.regions.push(other);
  const token=makeToken(scene,-6);
  token.isVisible=false;token.visible=false;token.mesh.visible=false;
  canvas.tokens.controlled=[underwaterViewer(scene,{x:250,y:10,elevation:-4})];
  canvas.visibility={testVisibility(){return true;}};
  game.user.isGM=false;
  assert.equal(hasInteriorWaterViewer(getTokenWaterState(token.document)),false);
  assert.equal(canSeeWaterTokenFromInterior(token),false);
  refreshTokenWaterVisualDepth(token);
  assert.equal(token.mesh.alpha,0);
  assert.equal(token.visible,false);
  resetViewerTests();
});


test("floating swimmer with eyes above surface cannot see past depth limit",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=2;makeVisual(scene);
 const target=makeToken(scene,-6); // top -4.5, beyond exterior limit
 target.isVisible=false;target.visible=false;target.mesh.visible=false;
 const swimmer=underwaterViewer(scene,{elevation:-0.75});
 swimmer.losHeight=0.55; // crossing water, but viewing from air
 canvas.tokens.controlled=[swimmer];
 canvas.visibility={testVisibility(){return true;}};
 game.user.isGM=false;
 const swimmerState=getTokenWaterState(swimmer.document);
 assert.equal(swimmerState.floating,true);
 assert.equal(swimmerState.inWater,true);
 assert.equal(getWaterObserverEyeElevation(swimmer,swimmerState),0.55);
 assert.equal(isWaterObserverSubmerged(swimmer,swimmerState),false);
 assert.equal(hasInteriorWaterViewer(getTokenWaterState(target.document)),false);
 assert.equal(hasExteriorWaterViewer(0),true);
 assert.equal(canSeeWaterTokenFromInterior(target),false);
 assert.equal(getTokenWaterVisualDisplay(target).opacity,0);
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.mesh.alpha,0);
 assert.equal(target.visible,false);
 resetViewerTests();
});
test("floating swimmer with eyes below surface retains interior visibility",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=2;makeVisual(scene);
 const target=makeToken(scene,-6);
 target.isVisible=false;target.visible=false;target.mesh.visible=false;
 const swimmer=underwaterViewer(scene,{elevation:-0.75});
 swimmer.losHeight=-0.25;
 canvas.tokens.controlled=[swimmer];
 canvas.visibility={testVisibility(){return true;}};
 game.user.isGM=false;
 assert.equal(getTokenWaterState(swimmer.document).floating,true);
 assert.equal(isWaterObserverSubmerged(swimmer),true);
 assert.equal(hasInteriorWaterViewer(getTokenWaterState(target.document)),true);
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,true);
 assert.equal(target.mesh.visible,true);
 assert.equal(target.mesh.alpha,1);
 resetViewerTests();
});
test("moving floating swim LOS across the surface re-applies exterior cap without moving target",()=>{
 const {scene,region}=makeScene();region.visibilityDepth=2;makeVisual(scene);
 const target=makeToken(scene,-7);
 target.isVisible=false;target.visible=false;target.mesh.visible=false;
 const swimmer=underwaterViewer(scene,{elevation:-0.75});
 swimmer.losHeight=-0.2;
 canvas.tokens.controlled=[swimmer];
 canvas.visibility={testVisibility(){return true;}};
 game.user.isGM=false;
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,true);
 assert.equal(target.mesh.alpha,1);
 swimmer.losHeight=0.4;
 refreshSceneWaterVisualDepth();
 assert.equal(target.visible,false);
 assert.equal(target.mesh.alpha,0);
 swimmer.losHeight=-0.3;
 refreshSceneWaterVisualDepth();
 assert.equal(target.visible,true);
 assert.equal(target.mesh.alpha,1);
 resetViewerTests();
});
test("floating swimmer with no LOS height falls back to physical top, not base",()=>{
 const {scene}=makeScene();
 const swimmer=underwaterViewer(scene,{elevation:-0.75});
 delete swimmer.losHeight;
 const state=getTokenWaterState(swimmer.document);
 assert.equal(state.floating,true);
 assert.equal(getWaterObserverEyeElevation(swimmer,state),0.75);
 assert.equal(isWaterObserverSubmerged(swimmer,state),false);
});


test("surface observer cannot see underwater token's HUD, elevation or effects beyond visibility",()=>{
 const {scene,region}=makeScene();
 region.depth=100;
 region.visibilityDepth=36;
 makeVisual(scene,"Tile");
 const target=makeToken(scene,-49.5);
 // Foundry draws these graphical children even when only mesh.alpha=0.
 // Hiding the parent Token is required to occlude the whole display tree.
 target.children=[
   {name:"tooltip-elevation",visible:true},
   {name:"effects",visible:true},
   {name:"bars",visible:true},
   {name:"nameplate",visible:true}
 ];
 target.mesh.visible=true;
 target.visible=true;
 const observer=underwaterViewer(scene,{elevation:-0.97});
 observer.losHeight=.53;
 canvas.tokens.controlled=[observer];
 canvas.visibility={testVisibility(){return true;}};
 game.user.isGM=false;
 assert.equal(getTokenWaterVisualDisplay(target).opacity,0);
 assert.equal(isWaterObserverSubmerged(observer),false);
 assert.equal(refreshTokenWaterVisualDepth(target),true);
 assert.equal(target.visible,false,"parent Token is hidden, not just its mesh");
 assert.equal(target.mesh.visible,false);
 assert.equal(target.document.hidden,undefined,"never set shared TokenDocument.hidden");
 assert.ok(target.children.every(c=>c.visible),
   "child display flags remain intact; invisible PIXI parent hides them all");
 resetViewerTests();
});

test("moving a surface observer underwater restores target AND its HUD with no document write",()=>{
 const {scene,region}=makeScene();region.depth=100;region.visibilityDepth=3;
 makeVisual(scene);
 const target=makeToken(scene,-20);
 target.children=[{visible:true,name:"elevation"},{visible:true,name:"status"}];
 const viewer=underwaterViewer(scene,{elevation:-0.75});
 viewer.losHeight=.35;
 canvas.tokens.controlled=[viewer];
 canvas.visibility={testVisibility(){return true;}};
 game.user.isGM=false;
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,false);
 assert.equal(target.mesh.visible,false);
 viewer.document.elevation=-4;viewer.losHeight=-3;
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,true);
 assert.equal(target.mesh.visible,true);
 assert.equal(target.mesh.alpha,1);
 assert.ok(target.children.every(child=>child.visible));
 viewer.document.elevation=-0.75;viewer.losHeight=.35;
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,false);
 target.document.elevation=-2;
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,true,"within exterior depth, HUD and image return");
 assert.equal(target.mesh.visible,true);
 assert.equal(target.document.hidden,undefined);
 resetViewerTests();
});

test("an emerged water token keeps its native HUD while its portrait uses foreground replica",()=>{
 const {scene}=makeScene();makeVisual(scene);
 const token=makeToken(scene,-0.75);
 token.children=[{name:"elevation",visible:true},{name:"effects",visible:true}];
 token.visible=true;
 refreshTokenWaterVisualDepth(token);
 assert.equal(token.visible,true,"emerged token parent must not be hidden");
 assert.equal(token.mesh.alpha,0,"only native image is hidden behind the tile");
 assert.ok(token.children.every(child=>child.visible),
   "HUD stays visible on emerged token");
});

test("a free-camera GM does not receive a client-local Token hide from exterior depth",()=>{
 const {scene,region}=makeScene();region.depth=100;region.visibilityDepth=3;
 makeVisual(scene);
 const target=makeToken(scene,-20);
 target.visible=true;target.mesh.visible=true;
 game.user.isGM=true;
 canvas.tokens.controlled=[];
 refreshTokenWaterVisualDepth(target);
 assert.equal(target.visible,true);
 assert.equal(target.document.hidden,undefined);
});
