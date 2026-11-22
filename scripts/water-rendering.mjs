import { MODULE_ID } from "./constants.mjs";
import { getTokenWaterState } from "./water-state.mjs";

let markerLayer = null;

function ensureLayer() {
  if (!globalThis.canvas?.ready || !globalThis.canvas?.interface || !globalThis.PIXI?.Container) return null;
  if (markerLayer?.parent === globalThis.canvas.interface) return markerLayer;
  if (markerLayer) markerLayer.destroy({ children: true });
  markerLayer = new PIXI.Container();
  markerLayer.name = MODULE_ID + "-surface-markers";
  markerLayer.eventMode = "none";
  globalThis.canvas.interface.addChild(markerLayer);
  return markerLayer;
}

export function refreshWaterSurfaceMarkers() {
  if (!globalThis.canvas?.ready) return;
  const layer = ensureLayer();
  if (!layer) return;
  layer.removeChildren().forEach((child) => child.destroy());
  if (!game.settings.get(MODULE_ID, "showSurfaceMarkers")) return;
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    if (!token || token.visible === false) continue;
    if (token.document?.hidden && !game.user?.isGM) continue;
    const state = getTokenWaterState(token.document);
    if (!state.intersectsSurface) continue;
    const center = token.center;
    if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y)) continue;
    const radiusX = Math.max(6, (token.w ?? 30) * 0.32);
    const radiusY = Math.max(4, (token.h ?? 30) * 0.16);
    const ring = new PIXI.Graphics();
    ring.lineStyle(3, 0x60D5F7, 0.88);
    ring.drawEllipse(center.x, center.y, radiusX, radiusY);
    layer.addChild(ring);
  }
}

export function registerWaterRenderingHooks() {
  Hooks.on("canvasReady", () => refreshWaterSurfaceMarkers());
  for (const event of ["createToken", "updateToken", "deleteToken",
                       "createRegion", "updateRegion", "deleteRegion",
                       "createTile", "updateTile", "deleteTile"]) {
    Hooks.on(event, () => refreshWaterSurfaceMarkers());
  }
  Hooks.on("canvasTearDown", () => {
    if (markerLayer) markerLayer.destroy({ children: true });
    markerLayer = null;
  });
}
