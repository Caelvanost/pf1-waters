export const MODULE_ID = "pf1-waters";
export const WATER_REGION_FLAG = "waterRegion";
export const WATER_MOVEMENT_FLAG = "waterMovement";
export const UNDERWATER_FLAG = "underwater";
export const EPSILON = 1e-6;

export function finite(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isPrimaryGM() {
  if (!game.user?.isGM) return false;
  const active = game.users?.activeGM;
  return !active || active.id === game.user.id;
}

export function canWriteToken(token) {
  const active = game.users?.activeGM;
  if (active) return active.id === game.user?.id;
  return Boolean(token?.isOwner || game.user?.isGM);
}

export function t(key, fallback) {
  const full = "PF1W." + key;
  const translated = game.i18n?.localize?.(full);
  return translated && translated !== full ? translated : fallback;
}
