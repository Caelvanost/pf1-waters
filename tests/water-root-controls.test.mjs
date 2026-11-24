import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  registerWaterBodyRootSceneControl
} from "../scripts/water-bodies.mjs";

let dialogs=0;
globalThis.game={
  user:{id:"GM",isGM:true},
  i18n:{localize:key=>key}
};
globalThis.canvas={
  scene:{id:"scene",flags:{},getFlag(){return undefined;}}
};
globalThis.ui={notifications:{warn(message){throw Error(message);}}};
globalThis.foundry={
  applications:{api:{DialogV2:{async wait(){dialogs++;return null;}}}}
};

function foundryControls(){
  return {
    tokens:{name:"tokens",order:0,tools:{select:{name:"select"}}},
    regions:{name:"regions",order:8,tools:{select:{name:"select"}}},
    tiles:{name:"tiles",order:4,tools:{select:{name:"select"}}}
  };
}

test("V13 exposes a GM-only root group at the same level as Tokens and Regions",()=>{
  const controls=foundryControls();
  registerWaterBodyRootSceneControl(controls);
  const group=controls.pf1Waters;
  assert.ok(group);
  assert.equal(group.name,"pf1Waters");
  assert.equal(group.visible,true);
  assert.equal(group.icon,"fa-solid fa-water");
  assert.ok(group.order>controls.regions.order);
  assert.equal(group.activeTool,"overview",
    "Foundry V13 requires an existing, persistent activeTool");
  assert.equal(group.tools.overview.name,"overview");
  assert.equal(group.tools.overview.button,undefined,
    "the default active tool cannot be a button or a toggle");
  assert.equal(group.tools.manageBodies.button,true);
  assert.equal(group.tools.manageBodies.name,"manageBodies");
  assert.equal(group.layer,undefined,"V13 root groups must not add a legacy layer property");
  const saved=group;
  registerWaterBodyRootSceneControl(controls);
  assert.equal(controls.pf1Waters,saved,"re-registering must not replace existing controls");
});

test("clicking the root icon opens the water registry without switching to Regions",()=>{
  dialogs=0;
  const controls=foundryControls();
  registerWaterBodyRootSceneControl(controls);
  controls.pf1Waters.onChange(null,true);
  assert.equal(dialogs,1);
  controls.pf1Waters.onChange(null,false);
  assert.equal(dialogs,1,"deactivation must not open an extra dialog");
  controls.pf1Waters.tools.manageBodies.onChange(null);
  assert.equal(dialogs,2,"management remains accessible from the subtool");
  assert.ok(controls.regions.tools.select,"the existing Regions palette remains untouched");
});

test("players have no PF1 Waters root controls or management action",()=>{
  const controls=foundryControls();
  game.user.isGM=false;
  try {
    registerWaterBodyRootSceneControl(controls);
    assert.equal(controls.pf1Waters,undefined);
  } finally {game.user.isGM=true;}
});

test("the main module registers the root handler on getSceneControlButtons",()=>{
  const source=readFileSync(new URL("../scripts/main.mjs",import.meta.url),"utf8");
  assert.match(source,/import \{ registerWaterBodyRootSceneControl \} from "\.\/water-bodies\.mjs"/);
  assert.match(source,/Hooks\.on\("getSceneControlButtons", registerWaterBodyRootSceneControl\)/);
});
