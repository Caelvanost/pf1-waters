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
  addChildAt(obj,i){this.children.splice(i,0,obj);obj.parent=this;return obj;}
  destroy(){this.destroyed=true;}
}
class Graphics {
  constructor(){this.position=new Point();this.rectangles=[];this.destroyed=false;}
  clear(){this.rectangles=[];return this;}
  rect(x,y,w,h){this.rectangles.push([x,y,w,h]);return this;}
  fill(){return this;}
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
  Container,Sprite,Graphics
};
globalThis.game={user:{isGM:true}};
const callbacks=new Map();
globalThis.Hooks={on(name,fn){callbacks.set(name,fn);}};
let loads=0;
globalThis.foundry={canvas:{loadTexture:async(src)=>{loads++;return {src};}}};

function scene(){
 const scene={id:"water-scene",grid:{size:100,distance:1.5},
   tiles:[],drawings:[],regions:[],
   flags:{"pf1-waters":{waterBodies:[{id:"body",name:"Lac",surface:0}]}},
   getFlag(ns,key){return this.flags?.[ns]?.[key];}
 };
 const region={id:"lake",parent:scene,elevation:0,
   flags:{"pf1-waters":{waterRegion:{
     enabled:true,bodyId:"body",depth:8,ringPng:""
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
 const sprite=holder.children.find(c=>c.texture?.src==="assets/ripples.png");
 const mask=holder.children.find(c=>c instanceof Graphics);
 assert.ok(sprite);assert.ok(mask);
 assert.equal(sprite.mask,mask);
 assert.equal(sprite.texture.src,"assets/ripples.png");
 assert.equal(sprite.position.x,50);
 assert.equal(sprite.width,150);
 assert.equal(sprite.height,150);
 assert.deepEqual(mask.rectangles,[
  [-75,-75,150,25],[-75,50,150,25],
  [-75,-50,25,100],[50,-50,25,100]
 ]);
 token.center={x:230,y:150};
 ticker.fn();
 assert.equal(sprite.position.x,230);
 assert.equal(sprite.position.y,150);
});
test("ring disappears on immersion, loss of PNG or token leaving surface",async()=>{
 const {doc,region,token,ticker}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 await refreshWaterSurfaceMarkers();
 const sprite=canvas.interface.children.at(-1).children.find(c=>c.texture);
 doc.elevation=-2.5;
 ticker.fn();
 assert.equal(sprite.destroyed,true);
 assert.equal(getTokenSurfaceRingPng(token),"");
 doc.elevation=-0.75;
 await refreshWaterSurfaceMarkers();
 const next=canvas.interface.children.at(-1).children.filter(c=>c.texture).at(-1);
 region.flags["pf1-waters"].waterRegion.ringPng="";
 await refreshWaterSurfaceMarkers();
 assert.equal(next.destroyed,true);
 assert.equal(ellipseCalls,0);
});

test("2x2 token defaults to 3x3 ripple image, with centre protected",async()=>{
 const {doc,region,token}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 doc.width=2;doc.height=2;token.w=200;token.h=200;
 token.center={x:100,y:100};
 await refreshWaterSurfaceMarkers();
 const holder=canvas.interface.children.at(-1);
 const sprite=holder.children.find(c=>c.texture);
 const mask=holder.children.find(c=>c instanceof Graphics);
 assert.equal(sprite.width,300);assert.equal(sprite.height,300);
 assert.deepEqual(mask.rectangles,[
  [-150,-150,300,50],[-150,100,300,50],
  [-150,-100,50,200],[100,-100,50,200]
 ]);
});
test("ripple layer lies beneath the water foreground token overlay",async()=>{
 const {region,iface}=scene();
 const overlay=new Container();overlay.name="pf1-waters-emerged-token-overlays";
 iface.addChild(overlay);
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 await refreshWaterSurfaceMarkers();
 assert.equal(iface.children[0].name,"pf1-waters-custom-surface-ripples");
 assert.equal(iface.children[1],overlay);
 assert.equal(ellipseCalls,0);
});
test("ripple mask follows token while moving and is removed on exit",async()=>{
 const {region,token,ticker}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 await refreshWaterSurfaceMarkers();
 const group=canvas.interface.children.at(-1);
 const sprite=group.children.find(c=>c.texture);
 const mask=sprite.mask;
 token.center={x:280,y:340};
 ticker.fn();
 assert.equal(sprite.position.x,280);
 assert.equal(mask.position.x,280);
 assert.equal(mask.position.y,340);
 region.flags["pf1-waters"].waterRegion.ringPng="";
 await refreshWaterSurfaceMarkers();
 assert.equal(sprite.destroyed,true);
 assert.equal(mask.destroyed,true);
});

test("a Region-defined ratio updates ripple size live, for a non-square token",async()=>{
 const {doc,region,token,ticker}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 region.flags["pf1-waters"].waterRegion.ringScale=2.4;
 doc.width=2;doc.height=1;token.w=200;token.h=100;
 token.center={x:100,y:50};
 await refreshWaterSurfaceMarkers();
 const holder=canvas.interface.children.at(-1);
 const sprite=holder.children.find(c=>c.texture);
 assert.equal(sprite.width,480);
 assert.equal(sprite.height,240);
 assert.equal(sprite.position.x,100);
 assert.equal(sprite.position.y,50);
 region.flags["pf1-waters"].waterRegion.ringScale=1.5;
 ticker.fn();
 assert.equal(sprite.width,300);
 assert.equal(sprite.height,150);
 assert.equal(sprite.position.x,100);
 assert.equal(sprite.position.y,50);
});
test("invalid or unspecified ripple ratio is 1.5, and no PNG means no sprite",async()=>{
 const {region,token}=scene();
 region.flags["pf1-waters"].waterRegion.ringScale=-1;
 assert.equal(await refreshWaterSurfaceMarkers(),0);
 assert.equal(canvas.interface.children.length,0);
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 assert.equal(await refreshWaterSurfaceMarkers(),1);
 const sprite=canvas.interface.children.at(-1).children.find(c=>c.texture);
 assert.equal(sprite.width,150);
 assert.equal(sprite.height,150);
});
test("small ratios place ripple beneath rather than over the portrait",async()=>{
 const {region}=scene();
 region.flags["pf1-waters"].waterRegion.ringPng="assets/ripples.png";
 region.flags["pf1-waters"].waterRegion.ringScale=0.9;
 await refreshWaterSurfaceMarkers();
 const group=canvas.interface.children.at(-1);
 const sprite=group.children.find(c=>c.texture);
 assert.equal(sprite.width,90);
 assert.equal(sprite.height,90);
 assert.equal(sprite.mask.rectangles.length,0,
   "a ripple wholly under the token remains obscured by the portrait mask");
});
