import { finite } from "./constants.mjs";
import { getWaterRegionData, getWaterBottomElevation, isWaterRegion, pointInsideWaterRegion2D, tokenCenter } from "./water-regions.mjs";

function sceneDistance2D(scene, a, b) {
  try {
    if (scene?.id === globalThis.canvas?.scene?.id &&
        typeof globalThis.canvas?.grid?.measurePath === "function") {
      const d = Number(globalThis.canvas.grid.measurePath([a, b])?.distance);
      if (Number.isFinite(d) && d >= 0) return d;
    }
  } catch (_) { /* Euclidean fallback */ }
  const size = finite(scene?.grid?.size, 0);
  const distance = finite(scene?.grid?.distance, 0);
  return size > 0 && distance > 0
    ? Math.hypot(b.x - a.x, b.y - a.y) / size * distance : null;
}

export function measureProjectileWaterDistance({ source, target, samplesPerGrid = 8 } = {}) {
  const from = source?.document ?? source;
  const to = target?.document ?? target;
  const scene = from?.parent;
  const empty = { distance: 0, unit: scene?.grid?.units ?? null,
    fraction: 0, totalDistance: 0, samples: 0, touchedRegionIds: [] };
  if (!from || !to || !scene || to.parent?.id !== scene.id) return empty;
  const a = tokenCenter(from);
  const b = tokenCenter(to);
  const z0 = finite(from.elevation, 0);
  const z1 = finite(to.elevation, 0);
  const horizontal = sceneDistance2D(scene, a, b);
  if (!Number.isFinite(horizontal)) return empty;
  const totalDistance = Math.hypot(horizontal, z1 - z0);
  if (totalDistance <= 0) return empty;
  const regions = [...(scene.regions ?? [])].filter(isWaterRegion);
  if (!regions.length) return { ...empty, totalDistance };
  const size = finite(scene.grid?.size, 100);
  const projected = Math.hypot(b.x - a.x, b.y - a.y);
  const requested = Math.ceil(projected / Math.max(1, size) * Math.max(1, Number(samplesPerGrid) || 8));
  const samples = Math.min(2048, Math.max(16, requested));
  let inside = 0;
  const touched = new Set();
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const z = z0 + (z1 - z0) * t;
    for (const region of regions) {
      const water = getWaterRegionData(region);
      const floor = getWaterBottomElevation(region);
      if (z >= water.surface || (floor !== null && z < floor)) continue;
      if (!pointInsideWaterRegion2D(point, region)) continue;
      inside++;
      touched.add(region.id);
      break;
    }
  }
  const fraction = inside / samples;
  return {
    distance: totalDistance * fraction,
    unit: scene.grid?.units ?? null,
    fraction, totalDistance, samples,
    touchedRegionIds: [...touched]
  };
}
