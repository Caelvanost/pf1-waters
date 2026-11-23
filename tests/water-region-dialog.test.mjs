import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { configureSelectedWaterRegions } from "../scripts/water-regions.mjs";

// Test the dialog contract without a browser or an active Foundry canvas.
test("Region editor is viewport-bounded, scrollable, and keeps FilePicker non-modal", async () => {
  let options;
  const scene = { id:"scene", grid:{units:"m"}, regions:[] };
  const document = {
    id:"region", parent:scene,
    getFlag(ns,key) {
      return ns==="pf1-waters" && key==="waterRegion"
        ? {enabled:true,surface:0,depth:30,visibilityDepth:36,sunlightHalfDepth:5,
           ringPng:"",ringScale:1.5}
        : undefined;
    }
  };
  globalThis.game={user:{isGM:true}};
  globalThis.canvas={scene,regions:{controlled:[{document}]}};
  globalThis.ui={notifications:{warn(){throw Error("Unexpected warning");}}};
  globalThis.foundry={
    utils:{escapeHTML:value=>String(value)},
    applications:{api:{DialogV2:{async prompt(config){options=config;return null;}}}}
  };
  await configureSelectedWaterRegions();
  assert.deepEqual(options.classes,["pf1-waters-region-dialog"]);
  assert.equal(options.position.height,"auto");
  assert.equal(options.position.width,520);
  assert.equal(options.modal,false,"native file picker must remain clickable");
  assert.match(options.content,/class="standard-form pf1-waters-region-fields"/);
  assert.match(options.content,/name="sunlightHalfDepth"/);
  assert.match(options.content,/<file-picker[^>]*name="ringPng"/);
  assert.match(options.content,/<\/p><\/div><div class="form-group"><label>/,
    "ripple scale field must not nest inside the PNG field");
  assert.equal(options.content.split("<div").length,
    options.content.split("</div>").length,"balanced field containers");
  const css=readFileSync(new URL("../styles/pf1-waters.css",import.meta.url),"utf8");
  assert.match(css,/\.application\.pf1-waters-region-dialog\s*\{[^}]*max-height:/s);
  assert.match(css,/\.pf1-waters-region-fields\s*\{[^}]*max-height:/s);
  assert.match(css,/\.pf1-waters-region-fields\s*\{[^}]*overflow-y:\s*auto/s);
});
