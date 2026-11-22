import test from "node:test";
import assert from "node:assert/strict";
import {
  getTokenSurfaceRingPng, refreshWaterSurfaceMarkers,
  registerWaterRenderingHooks
} from "../scripts/water-rendering.mjs";

const children=[];
let ellipseCalls=0;
class Point { constructor(){this.x=0;this.y=0;} set(x,y){this.x=x;this.y=y??x;} }
class Container {
  children=[]; parent=null; destroyed=false;
  addChild(obj){this.children.push(obj);obj.parent=this;return obj;}
  destroy(){this.destroyed=true;}
}
class Sprite {
  constructor(texture){
    this.texture=texture;this.position=new Point();this.anchor=new Point();
    this.parent=null;this.destroyed=false;
  }
  destroy(){this.destroyed=true;this.parent=null;}
}
globalThis.PIXI={
  Container,Sprite,Graphics:class {constructor(){ellipseCalls++;}}
};
globalThis.game={user:{isGM:true}};
const callbacks=new Map();
globalThis.Hooks={on(name,fn){callbacks.set(name,fn);}};
let loads=0;
globalThis.foundry={canvas:{loadTexture:async(src)=>{loads++;return {src};}}};

function scene(){
 const scene={id:"water-scene",grid:{size:100,distance:1.5},
   tiles:[],drawings:[],regions:[]};
 const region={id:"lake",parent:scene,elevation:0,
   flags:{"pf1-waters":{waterRegion:{
     enabled:true,surface:0,depth:8,ringPng:""
   }}},
   getFlag(ns,key){return this.flags[ns]?.[key];},
   testPoint(){return true;}};
 scene.regions.push(region);
 const doc={id:"pirate",parent:scene,elevation:-0.75,
   x:0,y:0,width:1,height:1,alpha:1,movementAction:"swim",
   getFlag(){return undefined;}};
 const token={document:doc,visible:true,center:{x:50,y:50},w:100,h:100};
 doc.object=token;
 const iface=new Container();
 const ticker={fn:null,add(fn){this.fn=fn;},remove(fn){if(this.fn===fn)this.fn=null;}};
 globalThis.canvas={ready:true,scene,interface:iface,
   tokens:{placeables:[token]},app:{ticker}};
 return {scene,region,doc,token,iface,ticker};
}
test("without configured PNG, no geometric ring is ever drawn",async()=>{
 const {token,iface}=scene();
 assert.equal(getTokenSurfaceRingPng(token),"");
 assert.equal(await refreshWaterSurfaceMarkers(),0);
 assert.equal(iface.children.length,0);
 assert.equal(ellipseCalls,0);
 registerWaterRenderingHooks();
 assert.equal(typeof callbacks.get("updateToken"),"function");
});
test("selected transparent PNG follows the actual animated token position",async()=>{
 const {region,token,ticker}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 assert.equal(getTokenSurfaceRingPng(token),"assets/ripples.png");
 assert.equal(await refreshWaterSurfaceMarkers(),1);
 assert.ok(loads>0);
 assert.equal(typeof ticker.fn,"function");
 assert.equal(ellipseCalls,0);
 const sprites=canvas.interface.children;
 assert.equal(sprites.length,1);
 const holder=sprites[0];
 const sprite=holder.children[0];
 assert.equal(sprite.texture.src,"assets/ripples.png");
 assert.equal(sprite.position.x,50);
 token.center={x:230,y:150};
 ticker.fn();
 assert.equal(sprite.position.x,230);
 assert.equal(sprite.position.y,150);
});
test("ring disappears on immersion, loss of PNG or token leaving surface",async()=>{
 const {doc,region,token,ticker}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 await refreshWaterSurfaceMarkers();
 const sprite=canvas.interface.children.at(-1).children.at(-1);
 doc.elevation=-2.5;
 ticker.fn();
 assert.equal(sprite.destroyed,true);
 assert.equal(getTokenSurfaceRingPng(token),"");
 doc.elevation=-0.75;
 await refreshWaterSurfaceMarkers();
 const next=canvas.interface.children.at(-1).children.at(-1);
 region.flags["pf1-waters"].waterRegion.ringPng="";
 await refreshWaterSurfaceMarkers();
 assert.equal(next.destroyed,true);
 assert.equal(ellipseCalls,0);
});
