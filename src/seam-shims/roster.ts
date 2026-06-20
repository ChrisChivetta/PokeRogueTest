// HOT-BUNDLE SHIM for ./roster — forwards to the HOST's live roster reader (shares any caches the
// host holds; readPartyValue/readCatchContext drive the policy's release/catch decisions).
const h = () => (globalThis as any).__hostSeam.roster as typeof import("../roster");

export const CLASSIC_RIBBON = h().CLASSIC_RIBBON;
export const readRoster = (...a: Parameters<typeof import("../roster").readRoster>) => h().readRoster(...a);
export const readCandyStarters = (...a: Parameters<typeof import("../roster").readCandyStarters>) => h().readCandyStarters(...a);
export const readCatchContext = (...a: Parameters<typeof import("../roster").readCatchContext>) => h().readCatchContext(...a);
export const readPartyValue = (...a: Parameters<typeof import("../roster").readPartyValue>) => h().readPartyValue(...a);
