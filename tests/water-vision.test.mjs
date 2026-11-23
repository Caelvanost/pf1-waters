import test from "node:test";
import assert from "node:assert/strict";
import {
  waterVisionFraction,getTokenUnderwaterVisionLimit,waterVisionPixels,
  constrainWaterVisionSourceData,patchWaterTokenVision,
  patchWaterTokenRanges,capWaterTokenPixelRange,
  refreshWaterVisionSources,waterVisionDiagnostics
} from "../scripts/water-vision.mjs";
import {
  getSceneWaterBodies,saveSceneWaterBody,
  getDefaultWaterVisionRange,getSceneWaterBody,configureSceneWaterBodies
} from "../scripts/water-bodies.mjs";

globalThis.game={user:{isGM:true},i18n:{localize:key=>key}};
globalThis.foundry={utils:{randomID:()=>"id-new"}};
const hooks=new Map();
globalThis.Hooks={on:(event,callback)=>hooks.set(event,callback)};

function fixture(){
  const scene={
    id:"vision-scene",grid:{size:100,distance:2,units:"m"},
    flags:{"pf1-waters":{waterBodies:[
      {id:"bay",name:"Baie",surface:0,visionEnabled:true,
        visionRange:40,visionHalfDepth:8},
      {id:"river",name:"Rivière",surface:0,visionEnabled:true,
        visionRange:8,visionHalfDepth:4}
    ]}},
    regions:[],tokens:[],
    getFlag(ns,key){return this.flags?.[ns]?.[key];},
    async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;}
  };
  function region(id,bodyId,minX,maxX) {
    const doc={
      id,parent:scene,elevation:{bottom:-200,top:0},
      flags:{"pf1-waters":{waterRegion:{enabled:true,bodyId,depth:200}}},
      getFlag(ns,key){return this.flags?.[ns]?.[key];},
      testPoint({x,y,elevation}){
        return x>=minX&&x<maxX&&y>=0&&y<300&&elevation>=-200&&elevation<=0;
      }
    };
    scene.regions.push(doc);
  }
  region("beach","bay",0,100);
  region("deep","bay",100,200);
  region("river","river",200,300);
  function viewer(id,{x=10,elevation=-9.5,losHeight=-8}={}) {
    const doc={
      id,name:id,parent:scene,x,y:10,width:1,height:1,
      elevation,sight:{enabled:true,range:null},
      light:{bright:0,dim:14},movementAction:"swim",getFlag(){return undefined;}
    };
    const token={document:doc,losHeight,controlled:true};
    doc.object=token;
    scene.tokens.push(doc);
    return token;
  }
  const updates=[];
  globalThis.canvas={ready:true,scene,grid:scene.grid,tokens:{placeables:[]},
    perception:{update:function(flags){updates.push(flags);}}};
  return {scene,viewer,updates};
}

test("water light fraction is physically exponential, not a sequence of arbitrary knots",()=>{
 for(const [depth,fraction] of [[0,1],[8,.5],[16,.25],[40,1/32],
     [160,2**-20],[200,2**-25]]){
   assert.ok(Math.abs(waterVisionFraction(depth,8)-fraction)<1e-12);
 }
 assert.equal(waterVisionFraction(1,0),0);
 assert.equal(waterVisionFraction(0,0),1);
 assert.ok(waterVisionFraction(160,8)>0);
});
test("water transparency range stays fixed at all depths and differs by water body",()=>{
  const {viewer}=fixture();
  const shallow=viewer("shallow",{x:10,elevation:-9.5,losHeight:-8});
  const deep=viewer("deep",{x:120,elevation:-17.5,losHeight:-16});
  const river=viewer("river",{x:210,elevation:-5.5,losHeight:-4});
  assert.equal(getTokenUnderwaterVisionLimit(shallow).range,40);
  assert.equal(getTokenUnderwaterVisionLimit(deep).range,40);
  assert.equal(getTokenUnderwaterVisionLimit(river).range,8);
  assert.ok(Math.abs(getTokenUnderwaterVisionLimit(shallow).lightFraction-.5)<1e-12);
  assert.ok(Math.abs(getTokenUnderwaterVisionLimit(deep).lightFraction-.25)<1e-12);
  assert.ok(Math.abs(getTokenUnderwaterVisionLimit(river).lightFraction-.5)<1e-12);
  assert.equal(getTokenUnderwaterVisionLimit(shallow).bodyName,"Baie");
});

test("eye outside water, token outside Region, or disabled body retains native sight",()=>{
  const {viewer,scene}=fixture();
  const floating=viewer("floating",{elevation:-.75,losHeight:0.6});
  const dry=viewer("dry",{x:330,elevation:-9,losHeight:-8});
  assert.equal(getTokenUnderwaterVisionLimit(floating),null);
  assert.equal(getTokenUnderwaterVisionLimit(dry),null);
  scene.flags["pf1-waters"].waterBodies[0].visionEnabled=false;
  assert.equal(getTokenUnderwaterVisionLimit(viewer("underwater")),null);
});

test("source data clips BOTH vision and light perception without mutating Token or lights",()=>{
  const {viewer}=fixture();
  const token=viewer("plongeur",{losHeight:-8});
  const input={radius:5000,lightRadius:7500,brightness:0,contrast:0,saturation:1,visionMode:"basic"};
  const output=constrainWaterVisionSourceData(token,input);
  assert.equal(waterVisionPixels(20,token.document.parent),1000);
  assert.equal(output.radius,2000);
  assert.equal(output.lightRadius,2000);
  assert.equal(output.visionMode,"basic");
  assert.equal(output.brightness,0);
  assert.equal(input.radius,5000);
  assert.equal(input.lightRadius,7500);
  assert.deepEqual(token.document.light,{bright:0,dim:14});
  assert.equal(token.document.sight.range,null);
});

test("a stricter PF1 sight radius remains stricter and magic lights cannot increase the cap",()=>{
  const {viewer}=fixture();
  const token=viewer("plongeur");
  const source=constrainWaterVisionSourceData(token,{radius:700,lightRadius:5000});
  assert.equal(source.radius,700);
  assert.equal(source.lightRadius,2000);
  assert.equal(constrainWaterVisionSourceData(token,{radius:null,lightRadius:null}).radius,2000);
  const air=viewer("air",{elevation:2,losHeight:3});
  const normal={radius:4200,lightRadius:9000};
  assert.equal(constrainWaterVisionSourceData(air,normal),normal);
});

test("no light sources or TokenDocuments are written during per-client source initialization",()=>{
  const {scene,viewer,updates}=fixture();
  const a=viewer("a",{x:10,losHeight:-8});
  const b=viewer("b",{x:120,losHeight:-16});
  const c=viewer("c",{x:210,losHeight:-4});
  const originals=[];
  class TokenClass{
    _getVisionSourceData(){return {radius:5000,lightRadius:8000,brightness:.2,visionMode:"darkvision"};}
  }
  assert.equal(patchWaterTokenVision(TokenClass),true);
  assert.equal(patchWaterTokenVision(TokenClass),true,"patch must be idempotent");
  for(const token of [a,b,c]){
    Object.setPrototypeOf(token,TokenClass.prototype);
    token.initializeVisionSource=function(){
      const data=this._getVisionSourceData();
      this.visionSource={radius:data.radius,lightRadius:data.lightRadius};
      originals.push(data);
    };
  }
  canvas.tokens.placeables=[a,b,c];
  assert.equal(refreshWaterVisionSources(scene),3);
  assert.deepEqual(originals.map(x=>x.radius),[2000,2000,400]);
  assert.deepEqual(originals.map(x=>x.lightRadius),[2000,2000,400]);
  assert.equal(originals.every(x=>x.visionMode==="darkvision"),true);
  assert.deepEqual(updates,[{refreshVision:true,refreshLighting:true}]);
  assert.equal(waterVisionDiagnostics(scene).length,3);
  assert.equal(a.document.sight.range,null);
  assert.equal(b.document.light.dim,14);
});

test("registering body vision settings preserves old registry values while allowing new inputs",async()=>{
  const {scene}=fixture();
  assert.equal(getSceneWaterBodies(scene)[0].visionRange,40);
  assert.equal(getSceneWaterBodies(scene)[1].visionHalfDepth,4);
  assert.ok(Math.abs(getDefaultWaterVisionRange({grid:{units:"feet"}})-25.5/.3048)<1e-10);
  await saveSceneWaterBody(scene,{id:"bay",name:"Baie corrigée",surface:2});
  assert.equal(getSceneWaterBody(scene,"bay").visionRange,40);
  assert.equal(getSceneWaterBody(scene,"bay").visionHalfDepth,8);
  await saveSceneWaterBody(scene,{id:"bay",name:"Baie claire",surface:3,
    visionEnabled:false,visionRange:70,visionHalfDepth:14});
  assert.deepEqual(
    (({visionEnabled,visionRange,visionHalfDepth})=>({visionEnabled,visionRange,visionHalfDepth}))(getSceneWaterBody(scene,"bay")),
    {visionEnabled:false,visionRange:70,visionHalfDepth:14}
  );
  await assert.rejects(saveSceneWaterBody(scene,{id:"bay",name:"bad",surface:0,visionRange:-2}),/positif/);
  await assert.rejects(saveSceneWaterBody(scene,{id:"bay",name:"bad",surface:0,visionHalfDepth:""}),/positif/);
});

test("per-scene settings default to scene units for previously created body records",()=>{
  const {scene}=fixture();
  scene.flags["pf1-waters"].waterBodies.push({id:"raw",name:"Old profile",surface:0});
  const body=getSceneWaterBody(scene,"raw");
  assert.equal(body.visionEnabled,true);
  assert.equal(body.waterClarity,null,"old body remains unchanged until edited");
  assert.equal(body.visionRange,25.5);
  assert.ok(Math.abs(body.visionHalfDepth-Math.LN2/.07)<1e-10);
  scene.grid.units="ft";
  assert.ok(Math.abs(getSceneWaterBody(scene,"raw").visionRange-25.5/.3048)<1e-10);
  assert.ok(Math.abs(getSceneWaterBody(scene,"raw").visionHalfDepth-
    Math.LN2/.07/.3048)<1e-10);
});

test("body manager asks only a qualitative water clarity, never numeric optical parameters",async()=>{
  const {scene}=fixture();
  const seen=[];
  globalThis.canvas.scene=scene;
  globalThis.ui={notifications:{info(){},warn(message){throw Error(message);},error(message){throw Error(message);}}};
  globalThis.foundry.applications={api:{DialogV2:{async prompt(options){
    seen.push(options.content);
    return seen.length===1?{action:"edit",bodyId:"bay"}:
      {id:"bay",name:"Baie",surface:0,waterClarity:"silty",visionEnabled:true};
  }}}};
  await configureSceneWaterBodies();
  assert.match(seen[1],/name="waterClarity"/);
  for(const profile of ["crystal","clear","slightlyMurky","murky","silty"])
    assert.match(seen[1],new RegExp('value="'+profile+'"'));
  assert.doesNotMatch(seen[1],/name="visionRange"/);
  assert.doesNotMatch(seen[1],/name="visionHalfDepth"/);
  assert.doesNotMatch(seen[1],/name="visionEnabled"/);
  assert.equal(getSceneWaterBody(scene,"bay").waterClarity,"silty");
  assert.equal(getSceneWaterBody(scene,"bay").visionRange,1.5);
  assert.ok(Math.abs(getSceneWaterBody(scene,"bay").visionHalfDepth-
    Math.LN2/.7)<1e-10);
});

test("GM clarity choice updates physical visibility and solar attenuation together",async()=>{
 const {scene,viewer}=fixture();
 const token=viewer("diver",{losHeight:-8});
 await saveSceneWaterBody(scene,{id:"bay",name:"Baie",surface:0,
   waterClarity:"crystal"});
 const clear=getTokenUnderwaterVisionLimit(token);
 assert.equal(clear.range,40.5);
 await saveSceneWaterBody(scene,{id:"bay",name:"Baie",surface:0,
   waterClarity:"silty"});
 const silty=getTokenUnderwaterVisionLimit(token);
 assert.equal(silty.range,1.5);
 assert.ok(silty.lightFraction<clear.lightFraction);
 assert.equal(silty.darkvision,false);
});
test("V13 native sight/light perception getters enforce the cap (source data has no radius)",()=>{
  const {viewer}=fixture();
  class FoundryToken{
    get sightRange(){return 9000;}
    get lightPerceptionRange(){return 10000;}
    get optimalSightRange(){return Math.max(this.sightRange,this.lightPerceptionRange);}
    _getVisionSourceData(){return {lightRadius:this.lightPerceptionRange,visionMode:"basic"};}
  }
  class PF1Token extends FoundryToken{}
  assert.equal(patchWaterTokenVision(PF1Token),true);
  assert.equal(patchWaterTokenRanges(PF1Token),true);
  const diver=viewer("deep",{losHeight:-16,elevation:-17.5});
  Object.setPrototypeOf(diver,PF1Token.prototype);
  assert.equal(diver.sightRange,2000);
  assert.equal(diver.lightPerceptionRange,2000);
  assert.equal(diver.optimalSightRange,2000);
  const data=diver._getVisionSourceData();
  assert.equal(data.lightRadius,2000);
  assert.equal(Object.hasOwn(data,"radius"),false,
    "Foundry V13 VisionSourceData does not define radius");
  diver.losHeight=3;diver.document.elevation=2;
  assert.equal(diver.sightRange,9000);
  assert.equal(diver.lightPerceptionRange,10000);
  assert.equal(diver.optimalSightRange,10000);
});

test("extreme depths affect light, not water transparency radius",()=>{
  const {viewer}=fixture();
  const diver=viewer("extreme",{losHeight:-160,elevation:-161});
  assert.ok(Math.abs(getTokenUnderwaterVisionLimit(diver).lightFraction-2**-20)<1e-12);
  assert.equal(getTokenUnderwaterVisionLimit(diver).range,40);
  assert.equal(waterVisionPixels(0,diver.document.parent),1);
  assert.equal(capWaterTokenPixelRange(diver,Infinity),2000);
  assert.equal(capWaterTokenPixelRange(diver,0),2000,
    "a zero-radius V13 polygon must never be interpreted as unlimited");
  const data=constrainWaterVisionSourceData(diver,{lightRadius:9999});
  assert.equal(data.lightRadius,2000,
    "the water's physical transparency remains 40 m even without daylight");
});

test("native 36m cap does not touch another, dry token source",()=>{
  const {viewer}=fixture();
  class BaseToken{
    get sightRange(){return Infinity;}
    get lightPerceptionRange(){return Infinity;}
    get optimalSightRange(){return Infinity;}
    _getVisionSourceData(){return {lightRadius:10000};}
  }
  class PF1Token extends BaseToken{}
  patchWaterTokenVision(PF1Token);
  const dry=viewer("dry",{elevation:3,losHeight:4});
  Object.setPrototypeOf(dry,PF1Token.prototype);
  assert.equal(dry.sightRange,Infinity);
  assert.equal(dry.lightPerceptionRange,Infinity);
  assert.equal(dry._getVisionSourceData().lightRadius,10000);
});

test("ordinary sight, low-light and darkvision share the same optical water cap",()=>{
  const {viewer}=fixture();
  const normal=viewer("ordinary",{losHeight:-160,elevation:-161});
  const low=viewer("low-light",{losHeight:-160,elevation:-161});
  low.document.sight.visionMode="lowlight";
  const dark=viewer("darkvision",{losHeight:-160,elevation:-161});
  dark.document.sight.visionMode="darkvision";
  for(const token of [normal,low,dark]){
    const limit=getTokenUnderwaterVisionLimit(token);
    assert.equal(limit.range,40);
    assert.ok(Math.abs(limit.lightFraction-2**-20)<1e-12);
    assert.equal(capWaterTokenPixelRange(token,10000),2000);
  }
  assert.equal(getTokenUnderwaterVisionLimit(normal).darkvision,false);
  assert.equal(getTokenUnderwaterVisionLimit(low).darkvision,false);
  assert.equal(getTokenUnderwaterVisionLimit(dark).darkvision,true);
  assert.equal(capWaterTokenPixelRange(dark,900),900,
    "the PF1 native darkvision radius remains the stronger limit");
});

test("changing body half-depth only alters natural-light factor, not sight radius",()=>{
  const {viewer,scene}=fixture();
  const token=viewer("diver",{losHeight:-8});
  const first=getTokenUnderwaterVisionLimit(token);
  scene.flags["pf1-waters"].waterBodies[0].visionHalfDepth=2;
  const second=getTokenUnderwaterVisionLimit(token);
  assert.equal(first.range,second.range);
  assert.equal(first.range,40);
  assert.ok(first.lightFraction>second.lightFraction);
});
