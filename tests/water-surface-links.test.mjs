import test from "node:test";
import assert from "node:assert/strict";
import {
  getWaterSurfaceData, resolveWaterSurfaceRegion, getWaterSurfacesForRegion,
  syncWaterSurfaceElevation, syncSceneWaterSurfaceElevations,
  configureSelectedWaterSurfaces, clearSelectedWaterSurfaces,
  registerWaterSurfaceSceneControls
} from "../scripts/water-surface-links.mjs";
import { getTokenWaterState } from "../scripts/water-state.mjs";

globalThis.game = {
  user: { id: "GM", isGM: true }, users: { activeGM: { id: "GM" } },
  i18n: { localize: (key) => key }
};
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.foundry = {
  utils: { escapeHTML: (text) => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;") },
  applications: { api: { DialogV2: { prompt: async () => ({ regionId: "lake", syncElevation: true }) } } }
};
function makeScene() {
  return { id: "scene", regions: [], tiles: [], drawings: [],
    grid: { size: 100, distance: 1.5, units: "m" } };
}
function region(scene, id="lake", surface=4) {
  const r={ id,name:id,parent:scene,flags:{"pf1-waters":{waterRegion:{enabled:true,surface,depth:10}}},
    getFlag(ns,key){return this.flags[ns]?.[key];},
    testPoint(){return true;} };
  scene.regions.push(r); return r;
}
function placeable(scene, type="Tile", id="surface") {
  const doc={documentName:type,id,parent:scene,elevation:0,flags:{},
    getFlag(ns,key){return this.flags[ns]?.[key];},
    async setFlag(ns,key,value){this.flags[ns]??={};this.flags[ns][key]=value;},
    async update(changes){Object.assign(this,changes);} };
  (type==="Tile"?scene.tiles:scene.drawings).push(doc);
  return doc;
}
function link(doc,regionId="lake",syncElevation=true) {
  doc.flags["pf1-waters"]={waterSurface:{enabled:true,regionId,syncElevation}};
}
test("visual surface points at a Region without any waterRegion flag",()=>{
  const s=makeScene(),r=region(s),tile=placeable(s),drawing=placeable(s,"Drawing");
  link(tile);link(drawing);
  assert.deepEqual(getWaterSurfaceData(tile),{enabled:true,regionId:"lake",syncElevation:true});
  assert.equal(tile.getFlag("pf1-waters","waterRegion"),undefined);
  assert.equal(resolveWaterSurfaceRegion(tile),r);
  assert.equal(resolveWaterSurfaceRegion(drawing),r);
  assert.deepEqual(getWaterSurfacesForRegion(r),[tile,drawing]);
});
test("unlinked and orphan visuals never become a water Region",()=>{
  const s=makeScene(),tile=placeable(s);
  link(tile,"deleted");
  assert.equal(resolveWaterSurfaceRegion(tile),null);
  assert.equal(getWaterSurfacesForRegion({id:"deleted",parent:s}).length,0);
  const token={id:"token",parent:s,x:0,y:0,width:1,height:1,elevation:-1};
  assert.equal(getTokenWaterState(token).inWater,false);
});
test("visual elevation aligns but physics Region surface remains unchanged",async()=>{
  const s=makeScene(),r=region(s,"lake",4),tile=placeable(s);
  link(tile);
  assert.equal(await syncWaterSurfaceElevation(tile),true);
  assert.equal(tile.elevation,4);
  assert.equal(r.getFlag("pf1-waters","waterRegion").surface,4);
  r.flags["pf1-waters"].waterRegion.surface=7;
  assert.deepEqual(await syncSceneWaterSurfaceElevations(s),{aligned:1,failed:0});
  assert.equal(tile.elevation,7);
  assert.equal(r.getFlag("pf1-waters","waterRegion").surface,7);
});
test("opt-out preserves visual elevation while Region remains mechanical",async()=>{
  const s=makeScene();region(s);const drawing=placeable(s,"Drawing");
  link(drawing,"lake",false);drawing.elevation=11;
  assert.equal(await syncWaterSurfaceElevation(drawing),false);
  assert.equal(drawing.elevation,11);
});
test("GM tools link a selected Tile then unlink it without modifying Region",async()=>{
  const s=makeScene();const r=region(s);const tile=placeable(s);
  globalThis.canvas={scene:s,tiles:{controlled:[{document:tile}]},drawings:{controlled:[]}};
  const controls={tiles:{tools:{}},drawings:{tools:{}}};
  registerWaterSurfaceSceneControls(controls);
  assert.equal(typeof controls.tiles.tools.pf1WatersTileLinkTool.onChange,"function");
  assert.equal(typeof controls.drawings.tools.pf1WatersDrawingLinkTool.onChange,"function");
  await configureSelectedWaterSurfaces("Tile");
  assert.equal(getWaterSurfaceData(tile).regionId,"lake");
  assert.equal(tile.elevation,4);
  assert.equal(r.getFlag("pf1-waters","waterRegion").enabled,true);
  await clearSelectedWaterSurfaces("Tile");
  assert.equal(getWaterSurfaceData(tile).enabled,false);
  assert.equal(r.getFlag("pf1-waters","waterRegion").enabled,true);
});
