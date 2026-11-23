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

test("depth curve has exact knots and zero beyond the extinction depth",()=>{
  for(const [depth,factor] of [[0,1],[8,.5],[16,.25],[40,.05],[160,0],[200,0]]){
    assert.ok(Math.abs(waterVisionFraction(depth,8)-factor)<1e-9);
  }
  assert.equal(waterVisionFraction(1,0),0);
  assert.equal(waterVisionFraction(0,0),1);
});

test("limits are per token and per Scene water body, independent of Region bottom",()=>{
  const {viewer}=fixture();
  const shallow=viewer("shallow",{x:10,elevation:-9.5,losHeight:-8});
  const deep=viewer("deep",{x:120,elevation:-17.5,losHeight:-16});
  const river=viewer("river",{x:210,elevation:-5.5,losHeight:-4});
  assert.equal(getTokenUnderwaterVisionLimit(shallow).range,20);
  assert.equal(getTokenUnderwaterVisionLimit(deep).range,10);
  assert.equal(getTokenUnderwaterVisionLimit(river).range,4);
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
  assert.equal(output.radius,1000);
  assert.equal(output.lightRadius,1000);
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
  assert.equal(source.lightRadius,1000);
  assert.equal(constrainWaterVisionSourceData(token,{radius:null,lightRadius:null}).radius,1000);
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
  assert.deepEqual(originals.map(x=>x.radius),[1000,500,200]);
  assert.deepEqual(originals.map(x=>x.lightRadius),[1000,500,200]);
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
  assert.equal(getDefaultWaterVisionRange({grid:{units:"feet"}}),120);
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
  assert.equal(body.visionRange,36);
  assert.equal(body.visionHalfDepth,9);
  scene.grid.units="ft";
  assert.equal(getSceneWaterBody(scene,"raw").visionRange,120);
  assert.equal(getSceneWaterBody(scene,"raw").visionHalfDepth,30);
});

test("body editor exposes adjustable underwater range and half-depth",async()=>{
  const {scene}=fixture();
  const seen=[];
  globalThis.canvas.scene=scene;
  globalThis.ui={notifications:{info(){},warn(message){throw Error(message);},error(message){throw Error(message);}}};
  globalThis.foundry.applications={api:{DialogV2:{async prompt(options){
    seen.push(options.content);
    return seen.length===1?{action:"edit",bodyId:"bay"}:
      {id:"bay",name:"Baie",surface:0,visionEnabled:true,
        visionRange:"24",visionHalfDepth:"12"};
  }}}};
  await configureSceneWaterBodies();
  assert.match(seen[1],/name="visionRange"/);
  assert.match(seen[1],/name="visionHalfDepth"/);
  assert.match(seen[1],/name="visionEnabled"/);
  assert.equal(getSceneWaterBody(scene,"bay").visionRange,24);
  assert.equal(getSceneWaterBody(scene,"bay").visionHalfDepth,12);
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
  assert.equal(diver.sightRange,500);
  assert.equal(diver.lightPerceptionRange,500);
  assert.equal(diver.optimalSightRange,500);
  const data=diver._getVisionSourceData();
  assert.equal(data.lightRadius,500);
  assert.equal(Object.hasOwn(data,"radius"),false,
    "Foundry V13 VisionSourceData does not define radius");
  diver.losHeight=3;diver.document.elevation=2;
  assert.equal(diver.sightRange,9000);
  assert.equal(diver.lightPerceptionRange,10000);
  assert.equal(diver.optimalSightRange,10000);
});

test("twenty times the half-depth remains limited: native zero means unbounded",()=>{
  const {viewer}=fixture();
  const diver=viewer("extreme",{losHeight:-160,elevation:-161});
  assert.equal(getTokenUnderwaterVisionLimit(diver).range,0);
  assert.equal(waterVisionPixels(0,diver.document.parent),1);
  assert.equal(capWaterTokenPixelRange(diver,Infinity),1);
  assert.equal(capWaterTokenPixelRange(diver,0),1,
    "a zero-radius V13 polygon must never be interpreted as unlimited");
  const data=constrainWaterVisionSourceData(diver,{lightRadius:9999});
  assert.equal(data.lightRadius,1,
    "the extreme depth must never restore unlimited light perception");
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
