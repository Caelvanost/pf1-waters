import test from "node:test";
import assert from "node:assert/strict";
import {
  refreshWaterSurfaceMarkers,
  registerWaterRenderingHooks
} from "../scripts/water-rendering.mjs";

test("legacy marker API never generates Canvas geometry", () => {
  const children=[];
  globalThis.canvas={ready:true,interface:{children,addChild(child){children.push(child)}}};
  let pixiGraphicsCalls=0;
  globalThis.PIXI={Graphics:class {constructor(){pixiGraphicsCalls++;}},
    Container:class {constructor(){throw Error("No ring layer should be created")}}};
  refreshWaterSurfaceMarkers();
  registerWaterRenderingHooks();
  assert.equal(children.length,0);
  assert.equal(pixiGraphicsCalls,0);
});
