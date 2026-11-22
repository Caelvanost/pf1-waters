/**
 * Legacy compatibility only. As of v1.3.0 PF1 Waters NEVER draws blue
 * geometric surface rings, regardless of old world settings. A translucent
 * Tile/Drawing is the sole water-surface decoration.
 *
 * Exported as harmless no-ops for third-party callers that referenced the
 * old functions. Do not register Canvas hooks or create PIXI.Graphics.
 */
export function refreshWaterSurfaceMarkers() {}
export function registerWaterRenderingHooks() {}
