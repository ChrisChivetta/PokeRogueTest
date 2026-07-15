// HOT-BUNDLE SHIM for ./bridge — used ONLY in dist/policy.hot.js (aliased by build.mjs).
//
// The live bridge singleton (scene cache, Button enum, handler readers) lives in the HOST bundle.
// This shim forwards every runtime binding to globalThis.__hostSeam.bridge so the swapped policy
// shares the exact live scene/handlers the engine is using. Types are erased at build time, so the
// `export type` lines re-use the real source's types without any runtime coupling.

const h = () => (globalThis as any).__hostSeam.bridge as typeof import("../bridge");

export const Button: typeof import("../bridge").Button = h().Button;
export const TYPE_NAMES = h().TYPE_NAMES;
export const UI_MODE_ORDER = h().UI_MODE_ORDER;

export const getScene = (...a: Parameters<typeof import("../bridge").getScene>) => h().getScene(...a);
export const isSceneReady = (...a: Parameters<typeof import("../bridge").isSceneReady>) => h().isSceneReady(...a);
export const typeName = (...a: Parameters<typeof import("../bridge").typeName>) => h().typeName(...a);
export const getUiModeName = (...a: Parameters<typeof import("../bridge").getUiModeName>) => h().getUiModeName(...a);
export const getUiModeNumber = (...a: Parameters<typeof import("../bridge").getUiModeNumber>) => h().getUiModeNumber(...a);
export const getActiveHandler = (...a: Parameters<typeof import("../bridge").getActiveHandler>) => h().getActiveHandler(...a);
export const getMysteryEncounter = (...a: Parameters<typeof import("../bridge").getMysteryEncounter>) => h().getMysteryEncounter(...a);
export const inMysteryEncounter = (...a: Parameters<typeof import("../bridge").inMysteryEncounter>) => h().inMysteryEncounter(...a);
export const getCurrentPhaseName = (...a: Parameters<typeof import("../bridge").getCurrentPhaseName>) => h().getCurrentPhaseName(...a);
export const getLearnMoveCandidate = (...a: Parameters<typeof import("../bridge").getLearnMoveCandidate>) => h().getLearnMoveCandidate(...a);

export type RawScene = import("../bridge").RawScene;
export type ButtonName = import("../bridge").ButtonName;
export type UiModeName = import("../bridge").UiModeName;
export type LearnMoveData = import("../bridge").LearnMoveData;
export type LearnMoveCandidate = import("../bridge").LearnMoveCandidate;
