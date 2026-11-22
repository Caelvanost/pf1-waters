import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateWaterVisualElevation, getTokenWaterVisualElevation,
  refreshTokenWaterVisualDepth, refreshSceneWaterVisualDepth,
  surfaceContainsTokenCenter
} from "../scripts/water-visual-depth.mjs";

globalThis.game = {
  settings: { get: () => true },
  user: { id: "gm", isGM: true }
};
let sortCalls = 0;
globalThis.canvas = {
  ready: true, scene: null,
  primary: {
    renderDirty: false,
    sortChildren() { sortCalls++; }
  },
  tokens: { placeables: [] }
};

function makeScene() {
  const scene = {
    id: "water-test", grid: { size: 100, distance: 1.5, units: "m" },
    regions: [], tiles: [], drawings: []
  };
  const region = {
    id: "r1", parent: scene, name: "Lac", elevation: 0,
    getFlag(ns, key) {
      if (ns === "pf1-waters" && key === "waterRegion")
        return { enabled: true, surface: 0, depth: 10 };
      return undefined;
    },
    testPoint({ x, y }) { return x >= 0 && x < 200 && y >= 0 && y < 200; }
  };
  scene.regions.push(region);
  return { scene, region };
}

function makeVisual(scene, type = "Tile", opts = {}) {
  const doc = {
    documentName: type, id: opts.id ?? (type + scene.tiles.length),
    parent: scene, x: opts.x ?? 0, y: opts.y ?? 0,
    width: opts.width ?? 200, height: opts.height ?? 200,
    elevation: opts.elevation ?? 0,
    rotation: 0, flags: { "pf1-waters": { waterSurface: {
      enabled: opts.enabled !== false,
      regionId: opts.regionId ?? "r1", syncElevation: true
    } } },
    getFlag(ns, key) { return this.flags[ns]?.[key]; }
  };
  (type === "Tile" ? scene.tiles : scene.drawings).push(doc);
  return doc;
}

function makeToken(scene, elevation, props = {}) {
  const doc = {
    parent: scene, id: "token", name: "Pirate",
    elevation, x: 10, y: 10, width: 1, height: 1,
    movementAction: props.fly ? "fly" : "walk",
    getFlag() { return undefined; }
  };
  const token = {
    document: doc,
    mesh: { elevation },
    center: { x: 60, y: 60 }
  };
  doc.object = token;
  canvas.scene = scene;
  canvas.tokens.placeables = [token];
  canvas.primary.renderDirty = false;
  return token;
}

test("pure rule: half submerged floats above 0, fully submerged doesn't", () => {
  const base = {
    inWater: true, flying: false,
    tokenBottom: -0.75, tokenTop: 0.75,
    surface: 0, intersectsSurface: true
  };
  assert.equal(calculateWaterVisualElevation(base, [0]), 0.001);
  assert.equal(calculateWaterVisualElevation({ ...base, tokenBottom: -1.5, tokenTop: 0,
    intersectsSurface: false }, [0]), null);
  assert.equal(calculateWaterVisualElevation({ ...base, flying: true }, [0]), null);
  assert.equal(calculateWaterVisualElevation(base, []), null);
  assert.equal(calculateWaterVisualElevation({ ...base, tokenBottom: -0.2, tokenTop: 1.3 }, [-2]), 0.001);
});

test("linked tile promotes only the token's display mesh, not the document", () => {
  const { scene } = makeScene();
  makeVisual(scene);
  const token = makeToken(scene, -0.75);
  sortCalls = 0;
  assert.equal(getTokenWaterVisualElevation(token), 0.001);
  assert.equal(refreshTokenWaterVisualDepth(token), true);
  assert.equal(token.mesh.elevation, 0.001);
  assert.equal(token.document.elevation, -0.75);
  assert.equal(sortCalls, 1);
  assert.equal(canvas.primary.renderDirty, true);
  assert.equal(refreshTokenWaterVisualDepth(token), false);
});

test("full immersion restores native mesh elevation; exit from water also restores", () => {
  const { scene } = makeScene();
  makeVisual(scene);
  const token = makeToken(scene, -0.75);
  refreshTokenWaterVisualDepth(token);
  token.document.elevation = -1.5;
  assert.equal(refreshTokenWaterVisualDepth(token), true);
  assert.equal(token.mesh.elevation, -1.5);
  token.document.elevation = -0.75;
  assert.equal(refreshTokenWaterVisualDepth(token), true);
  token.document.x = 400;
  // Mock Token.center follows the live TokenDocument position as it does in Foundry.
  token.center = { x: 450, y: 60 };
  assert.equal(refreshTokenWaterVisualDepth(token), true);
  assert.equal(token.mesh.elevation, -0.75);
});

test("visual Drawing can supply the linked surface; no Tile required", () => {
  const { scene } = makeScene();
  const drawing = makeVisual(scene, "Drawing");
  const token = makeToken(scene, -0.75);
  assert.equal(surfaceContainsTokenCenter(drawing, token), true);
  assert.equal(refreshTokenWaterVisualDepth(token), true);
  assert.equal(token.mesh.elevation, 0.001);
});

test("unlinked surface never triggers visual override", () => {
  const { scene } = makeScene();
  makeVisual(scene, "Tile", { regionId: "unrelated" });
  const token = makeToken(scene, -0.75);
  assert.equal(getTokenWaterVisualElevation(token), null);
  assert.equal(refreshTokenWaterVisualDepth(token), false);
  assert.equal(token.mesh.elevation, -0.75);
});

test("visual footprint keeps unrelated linked surfaces from affecting token", () => {
  const { scene } = makeScene();
  makeVisual(scene, "Tile", { x: 350, y: 350, width: 100, height: 100 });
  const token = makeToken(scene, -0.75);
  assert.equal(getTokenWaterVisualElevation(token), null);
  assert.equal(refreshTokenWaterVisualDepth(token), false);
});

test("multiple overlapping visual surfaces use highest actual visual elevation", () => {
  const { scene } = makeScene();
  makeVisual(scene);
  makeVisual(scene, "Drawing", { elevation: 1.5 });
  const token = makeToken(scene, -0.75);
  assert.equal(getTokenWaterVisualElevation(token), 1.501);
});

test("disabled setting and flight restore the unmodified token", () => {
  const { scene } = makeScene();
  makeVisual(scene);
  const token = makeToken(scene, -0.75);
  refreshTokenWaterVisualDepth(token);
  game.settings.get = () => false;
  assert.equal(refreshTokenWaterVisualDepth(token), true);
  assert.equal(token.mesh.elevation, -0.75);
  game.settings.get = () => true;
  token.document.movementAction = "fly";
  assert.equal(refreshTokenWaterVisualDepth(token), false);
  assert.equal(token.mesh.elevation, -0.75);
});

test("bulk refresh follows token changes on the current client canvas", () => {
  const { scene } = makeScene();
  makeVisual(scene);
  const token = makeToken(scene, -0.75);
  assert.equal(refreshSceneWaterVisualDepth(), 1);
  assert.equal(refreshSceneWaterVisualDepth(), 0);
  token.document.elevation = -1.5;
  assert.equal(refreshSceneWaterVisualDepth(), 1);
});

test("primary-geometry query honors visual shape selection", () => {
  const { scene } = makeScene();
  const drawing = makeVisual(scene, "Drawing");
  drawing.object = { shape: { containsCanvasPoint: () => false } };
  const token = makeToken(scene, -0.75);
  assert.equal(surfaceContainsTokenCenter(drawing, token), false);
  assert.equal(refreshTokenWaterVisualDepth(token), false);
});
