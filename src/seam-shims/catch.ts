// HOT-BUNDLE SHIM for ./catch — forwards to the HOST's live catch singleton so per-target attempt
// counts + ball/decision telemetry stay continuous across a policy swap.
const h = () => (globalThis as any).__hostSeam.catch as typeof import("../catch");

export const PokeballType = h().PokeballType;
export const ballsThrownCount = (...a: Parameters<typeof import("../catch").ballsThrownCount>) => h().ballsThrownCount(...a);
export const lastCatchDecision = (...a: Parameters<typeof import("../catch").lastCatchDecision>) => h().lastCatchDecision(...a);
export const resetCatch = (...a: Parameters<typeof import("../catch").resetCatch>) => h().resetCatch(...a);
export const shouldCatch = (...a: Parameters<typeof import("../catch").shouldCatch>) => h().shouldCatch(...a);
export const pickBall = (...a: Parameters<typeof import("../catch").pickBall>) => h().pickBall(...a);
export const noteCatchAttempt = (...a: Parameters<typeof import("../catch").noteCatchAttempt>) => h().noteCatchAttempt(...a);
export const shouldSoftenBeforeCatch = (...a: Parameters<typeof import("../catch").shouldSoftenBeforeCatch>) => h().shouldSoftenBeforeCatch(...a);
export const noteSoftenTurn = (...a: Parameters<typeof import("../catch").noteSoftenTurn>) => h().noteSoftenTurn(...a);
export const worthCatching = (...a: Parameters<typeof import("../catch").worthCatching>) => h().worthCatching(...a);
export const pickReleaseSlot = (...a: Parameters<typeof import("../catch").pickReleaseSlot>) => h().pickReleaseSlot(...a);

export type PartyMon = import("../catch").PartyMon;
export type CatchContext = import("../catch").CatchContext;
