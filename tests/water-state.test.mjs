import test from "node:test";
import assert from "node:assert/strict";
import { getTokenWaterState, getTokenPhysicalHeight, getTokenSwimElevation,
  tokenHasFooting, hasWaterWalkFlag, WATER_CLASSIFICATION } from "../scripts/water-state.mjs";
import { getWaterRegionData, getWaterBottomElevation,
  migrateLegacyWaterRegions } from "../scripts/water-regions.mjs";
import { syncTokenWaterMovement, syncTokenUnderwaterFlag, hasWaterWalkFlagUpdate } from "../scripts/water-movement.mjs";
import { measureProjectileWaterDistance } from "../scripts/water-projectiles.mjs";

globalThis.game = { user: { id: "GM", isGM: true }, users: { activeGM: { id: "GM" } },
  scenes: [], i18n: { localize: x => x } };
globalThis.CONFIG = { statusEffects: [{ id: "swim", name: "Nager" }] };
globalThis.ui = { notifications: { info() {}, warn() {} } };

function scene() { return { id: "scene", grid: { size: 100, distance: 1.5, units: "m" }, regions: [], tokens: [] }; }
function region(s, {id="r1",surface=0,depth=null,minX=0,maxX=1000,legacy=false}={}) {
  const namespace = legacy ? "pf1-skull-and-shackles" : "pf1-waters";
  const r = { id, name:id, parent:s, elevation:0,
    flags: { [namespace]: { waterRegion: { enabled:true, surface, depth } } },
    getFlag(ns,k) { return this.flags[ns]?.[k]; },
    async setFlag(ns,k,v) { this.flags[ns] ??= {}; this.flags[ns][k] = v; },
    testPoint({x,y}) { return x>=minX && x<=maxX && y>=0 && y<=1000; } };
  s.regions.push(r); return r;
}
function token(s,props={}) {
  const actor = { statuses:new Set(),effects:[],async toggleStatusEffect(id,{active}) {
    if(active)this.statuses.add(id);else this.statuses.delete(id);
  }};
  const d = { id:"t"+(s.tokens.length+1),parent:s,x:0,y:0,width:1,height:1,
    elevation:0,movementAction:"walk",flags:{},isOwner:true,actor,...props,
    getFlag(ns,k) {return this.flags[ns]?.[k];},
    async setFlag(ns,k,v) {this.flags[ns]??={};this.flags[ns][k]=v;},
    async update(c) {Object.assign(this,c);} };
  d.uuid="Scene.scene.Token."+d.id;s.tokens.push(d);return d;
}
test("1x1 at surface -0.75 is half submerged, not underwater",()=>{
  const s=scene();const r=region(s);const d=token(s,{elevation:-0.75});
  const w=getTokenWaterState(d);
  assert.equal(getTokenPhysicalHeight(d),1.5);
  assert.equal(w.tokenTop,0.75);assert.equal(w.immersion,0.5);
  assert.equal(w.classification,WATER_CLASSIFICATION.INTERSECTING_SURFACE);
  assert.equal(w.underwater,false);assert.equal(getTokenSwimElevation(d,r),-0.75);
});
test("above and underwater classification and custom physical height",()=>{
  const s=scene();region(s);const d=token(s,{elevation:0});
  assert.equal(getTokenWaterState(d).classification,WATER_CLASSIFICATION.ABOVE_WATER);
  d.elevation=-1.5;
  assert.equal(getTokenWaterState(d).classification,WATER_CLASSIFICATION.UNDERWATER);
  d.width=2;d.height=2;assert.equal(getTokenPhysicalHeight(d),3);
  d.flags["pf1-waters"]={physicalHeight:2.1};
  assert.equal(getTokenPhysicalHeight(d),2.1);
});
test("bottom calculation, footing and overlapping Regions",()=>{
  const s=scene();const high=region(s,{id:"high",surface:0,depth:2});
  region(s,{id:"low",surface:-5,depth:5});
  const d=token(s,{elevation:-7});
  assert.equal(getTokenWaterState(d).regionId,"low");
  assert.equal(getWaterBottomElevation(high),-2);
  d.elevation=-2;assert.equal(tokenHasFooting(d,high),true);
});
test("walk at the exact surface starts half-height swimming",async()=>{
  const s=scene();region(s,{depth:6});const d=token(s,{elevation:0,movementAction:"walk"});
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,-0.75);
  assert.equal(d.actor.statuses.has("swim"),true);
  assert.equal(d.getFlag("pf1-waters","waterMovement").inWater,true);
});
test("world waterwalk true prevents the initial surface drop while walking",async()=>{
  const s=scene();region(s,{depth:6});
  const d=token(s,{elevation:0,movementAction:"walk"});
  await d.setFlag("world","waterwalk",true);
  assert.equal(hasWaterWalkFlag(d),true);
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,0);
  assert.equal(d.actor.statuses.has("swim"),false);
  assert.equal(getTokenWaterState(d).inWater,false);
  assert.equal(d.getFlag("pf1-waters","waterMovement"),undefined);
});
test("module namespace waterwalk also prevents the surface drop",async()=>{
  const s=scene();region(s,{depth:6});
  const d=token(s,{elevation:0,movementAction:"walk"});
  await d.setFlag("pf1-waters","waterwalk",true);
  assert.equal(hasWaterWalkFlag(d),true);
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,0);
  assert.equal(d.actor.statuses.has("swim"),false);
});
test("waterwalk is only enabled by boolean true, not a string or false",async()=>{
  const s=scene();region(s,{depth:6});
  for(const value of [false,"true",1,null]){
    const d=token(s,{elevation:0,movementAction:"walk"});
    await d.setFlag("world","waterwalk",value);
    assert.equal(hasWaterWalkFlag(d),false);
    await syncTokenWaterMovement(d);
    assert.equal(d.elevation,-0.75);
  }
});
test("removing waterwalk at surface restores the ordinary half-height snap",async()=>{
  const s=scene();region(s,{depth:6});
  const d=token(s,{elevation:0,movementAction:"walk"});
  await d.setFlag("world","waterwalk",true);
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,0);
  await d.setFlag("world","waterwalk",false);
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,-0.75);
});
test("waterwalk applied underwater never teleports a token back to the surface",async()=>{
  const s=scene();region(s,{depth:6});
  const d=token(s,{elevation:-2,movementAction:"walk"});
  await d.setFlag("world","waterwalk",true);
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,-2);
  assert.equal(d.actor.statuses.has("swim"),true);
  // It remains subject to the physical bottom.
  d.elevation=-10;
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,-6);
});
test("waterwalk flag updates trigger synchronization without feedback loops",()=>{
  for(const update of [
    {flags:{world:{waterwalk:true}}},
    {flags:{world:{"-=waterwalk":null}}},
    {flags:{"pf1-waters":{waterwalk:false}}},
    {"flags.world.waterwalk":true},
    {"flags.pf1-waters.-=waterwalk":null},
    {"flags.world":{waterwalk:true}},
    {flags:{"world.waterwalk":true}}
  ])assert.equal(hasWaterWalkFlagUpdate(update),true);
  for(const update of [
    {x:100}, {flags:{world:{underwater:true}}},
    {flags:{"pf1-waters":{waterMovement:{inWater:true}}}},
    {flags:{"pf1-waters":{underwater:false}}}
  ])assert.equal(hasWaterWalkFlagUpdate(update),false);
});
test("walking higher than the surface does not snap or enter swimming",async()=>{
  const s=scene();region(s,{depth:6});
  for(const elevation of [4,0.2]){
    const d=token(s,{elevation,movementAction:"walk"});
    await syncTokenWaterMovement(d);
    assert.equal(d.elevation,elevation);
    assert.equal(d.actor.statuses.has("swim"),false);
    assert.equal(d.getFlag("pf1-waters","waterMovement"),undefined);
  }
});
test("already submerged token keeps its chosen depth regardless of walking",async()=>{
  const s=scene();region(s,{depth:6});
  for(const elevation of [-0.2,-2]){
    const d=token(s,{elevation,movementAction:"walk"});
    await syncTokenWaterMovement(d);
    assert.equal(d.elevation,elevation);
    assert.equal(d.actor.statuses.has("swim"),true);
  }
});
test("swimming or non-walking at the surface does not snap",async()=>{
  const s=scene();region(s,{depth:6});
  for(const action of ["swim","climb","burrow",""]){
    const d=token(s,{elevation:0,movementAction:action});
    await syncTokenWaterMovement(d);
    assert.equal(d.elevation,0);
    assert.equal(d.actor.statuses.has("swim"),false);
  }
});
test("an existing swimmer can rise to shallower immersion without being snapped back",async()=>{
  const s=scene();region(s,{depth:6});const d=token(s,{elevation:0,movementAction:"walk"});
  await syncTokenWaterMovement(d);assert.equal(d.elevation,-0.75);
  d.movementAction="swim";d.elevation=-2;
  await syncTokenWaterMovement(d);assert.equal(d.elevation,-2);
  d.elevation=-0.2;
  await syncTokenWaterMovement(d);assert.equal(d.elevation,-0.2);
});
test("very shallow water sets a walking entrant on the bottom, not through it",async()=>{
  const s=scene();region(s,{depth:0.2});
  const d=token(s,{elevation:0,movementAction:"walk"});
  await syncTokenWaterMovement(d);
  assert.equal(d.elevation,-0.2);
  assert.equal(d.actor.statuses.has("swim"),false);
});

test("flying token is not snapped; bottom clamp removes Nager",async()=>{
  const s=scene();region(s,{depth:1});
  const flying=token(s,{elevation:7,movementAction:"fly"});
  await syncTokenWaterMovement(flying);assert.equal(flying.elevation,7);
  const swimmer=token(s,{elevation:-9});
  swimmer.actor.statuses.add("swim");
  await syncTokenWaterMovement(swimmer);assert.equal(swimmer.elevation,-1);
  assert.equal(swimmer.actor.statuses.has("swim"),false);
});
test("leaving Region clears status and mirrored flags",async()=>{
  const s=scene();region(s);const d=token(s,{elevation:-2});
  await syncTokenWaterMovement(d);await syncTokenUnderwaterFlag(d);
  assert.equal(d.getFlag("world","underwater"),true);
  assert.equal(d.getFlag("pf1-waters","underwater"),true);
  d.x=1500;await syncTokenWaterMovement(d);await syncTokenUnderwaterFlag(d);
  assert.equal(d.actor.statuses.has("swim"),false);
  assert.equal(d.getFlag("world","underwater"),false);
});
test("legacy Region migration preserves source and disabled canonical takes precedence",async()=>{
  const s=scene();const r=region(s,{legacy:true,surface:3,depth:8});
  assert.deepEqual(getWaterRegionData(r),{enabled:true,surface:3,depth:8,ringPng:"",visibilityDepth:36});
  game.scenes=[s];assert.equal((await migrateLegacyWaterRegions()).migrated,1);
  assert.deepEqual(r.getFlag("pf1-waters","waterRegion"),{enabled:true,surface:3,depth:8,ringPng:"",visibilityDepth:36});
  assert.ok(r.getFlag("pf1-skull-and-shackles","waterRegion").enabled);
  r.flags["pf1-waters"].waterRegion.enabled=false;
  assert.equal(getWaterRegionData(r).enabled,false);game.scenes=[];
});
test("projectile partially crossing water measures an immersed fraction",()=>{
  const s=scene();region(s,{depth:20});
  const a=token(s,{x:0,elevation:1}),b=token(s,{x:500,elevation:-3});
  const m=measureProjectileWaterDistance({source:a,target:b,samplesPerGrid:80});
  assert.ok(m.fraction>0.7&&m.fraction<0.8);
  assert.ok(m.distance>0&&m.distance<m.totalDistance);
  assert.deepEqual(m.touchedRegionIds,["r1"]);
});
test("works without Levels or Wall Height",()=>{
  const s=scene();region(s);assert.equal(getTokenWaterState(token(s,{elevation:-0.75})).inWater,true);
});

test("optional custom ring PNG resides only in the Region flag",()=>{
 const s=scene(),r=region(s);
 assert.equal(getWaterRegionData(r).ringPng,"");
 r.flags["pf1-waters"].waterRegion.ringPng="worlds/my-world/assets/ripples.png";
 assert.equal(getWaterRegionData(r).ringPng,"worlds/my-world/assets/ripples.png");
 assert.equal(getWaterRegionData(r).surface,0);
});

test("water Region dialog accepts a Foundry resource PNG without changing physics",async()=>{
 const s=scene(),r=region(s,{depth:6});
 globalThis.canvas={scene:s,regions:{controlled:[{document:r}]}};
 globalThis.foundry={utils:{escapeHTML:v=>String(v)},
  applications:{api:{DialogV2:{prompt:async(config)=>{
   assert.ok(config.content.includes('<file-picker type="image" name="ringPng"'));
   assert.equal(config.modal,false,
     "The native Foundry file browser must remain clickable outside the water Region dialog");
   return {surface:0,depth:6,ringPng:"worlds/pirates/images/remous.png",visibilityDepth:2.25};
  }}}}};
 const notifications=[];ui.notifications.info=x=>notifications.push(x);
 const {configureSelectedWaterRegions}=await import("../scripts/water-regions.mjs");
 await configureSelectedWaterRegions();
 assert.equal(r.getFlag("pf1-waters","waterRegion").ringPng,
   "worlds/pirates/images/remous.png");
 assert.equal(getWaterRegionData(r).depth,6);
 assert.equal(getWaterRegionData(r).visibilityDepth,2.25);
 assert.equal(notifications.length,1);
});

test("Region underwater visibility is configurable and independent of physical depth",()=>{
 const s=scene(),r=region(s,{depth:12});
 assert.equal(getWaterRegionData(r).visibilityDepth,36);
 r.flags["pf1-waters"].waterRegion.visibilityDepth=2.25;
 assert.equal(getWaterRegionData(r).visibilityDepth,2.25);
 r.flags["pf1-waters"].waterRegion.visibilityDepth=0;
 assert.equal(getWaterRegionData(r).visibilityDepth,0);
 assert.equal(getWaterRegionData(r).depth,12);
});

test("floating means the creature intersects water surface, even without footing",async()=>{
 const s=scene();region(s,{depth:8});
 const d=token(s,{elevation:-0.75,movementAction:"swim"});
 const state=getTokenWaterState(d);
 assert.equal(state.floating,true);
 assert.equal(state.hasFooting,false);
 assert.equal(Object.hasOwn(state,"standing"),false);
 await syncTokenWaterMovement(d);
 assert.equal(d.getFlag("pf1-waters","waterMovement").floating,true);
 assert.equal(d.getFlag("pf1-waters","waterMovement").hasFooting,false);
 await syncTokenUnderwaterFlag(d);
 assert.equal(d.getFlag("pf1-waters","floating"),true);
 assert.equal(d.getFlag("pf1-waters","hasFooting"),false);
 d.elevation=-2;
 await syncTokenWaterMovement(d);
 await syncTokenUnderwaterFlag(d);
 assert.equal(d.getFlag("pf1-waters","floating"),false);
 assert.equal(d.getFlag("pf1-waters","hasFooting"),false);
 assert.equal(d.getFlag("world","underwater"),true);
});
test("shallow surface contact can be floating and have footing simultaneously",async()=>{
 const s=scene();region(s,{depth:0.2});
 const d=token(s,{elevation:-0.2,movementAction:"walk"});
 const state=getTokenWaterState(d);
 assert.equal(state.floating,true);
 assert.equal(state.hasFooting,true);
 await syncTokenWaterMovement(d);
 await syncTokenUnderwaterFlag(d);
 assert.deepEqual({
   floating:d.getFlag("pf1-waters","floating"),
   hasFooting:d.getFlag("pf1-waters","hasFooting")
 },{floating:true,hasFooting:true});
 d.x=1500;await syncTokenWaterMovement(d);await syncTokenUnderwaterFlag(d);
 assert.equal(d.getFlag("pf1-waters","floating"),false);
 assert.equal(d.getFlag("pf1-waters","hasFooting"),false);
});
test("legacy standing is replaced by hasFooting during movement sync",async()=>{
 const s=scene();region(s,{depth:0.5});
 const d=token(s,{elevation:-0.5});
 await d.setFlag("pf1-waters","waterMovement",{standing:true,inWater:true});
 await syncTokenWaterMovement(d);
 const saved=d.getFlag("pf1-waters","waterMovement");
 assert.equal(saved.hasFooting,true);
 assert.equal(saved.floating,true);
 assert.equal(Object.hasOwn(saved,"standing"),false);
});

test("unconfigured visibility is exactly 36m in a metric Scene",()=>{
 const s=scene(),r=region(s,{depth:200});
 assert.equal(getWaterRegionData(r).visibilityDepth,36);
 r.flags["pf1-waters"].waterRegion.visibilityDepth=null;
 assert.equal(getWaterRegionData(r).visibilityDepth,36);
 delete r.flags["pf1-waters"].waterRegion.visibilityDepth;
 assert.equal(getWaterRegionData(r).visibilityDepth,36);
});
test("feet Scenes default to 120ft; explicit values and zero take precedence",()=>{
 const s=scene();s.grid.units="ft";s.grid.distance=5;
 const r=region(s,{depth:200});
 assert.equal(getWaterRegionData(r).visibilityDepth,120);
 s.grid.units="pieds";
 assert.equal(getWaterRegionData(r).visibilityDepth,120);
 r.flags["pf1-waters"].waterRegion.visibilityDepth=12;
 assert.equal(getWaterRegionData(r).visibilityDepth,12);
 r.flags["pf1-waters"].waterRegion.visibilityDepth=0;
 assert.equal(getWaterRegionData(r).visibilityDepth,0);
});
