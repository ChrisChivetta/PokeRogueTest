// HOT-BUNDLE SHIM for ./retry — forwards to the HOST's live retry singleton. CRITICAL: the host
// tick calls noteWave/noteRetry/shouldRetry while the policy reads retryGeneration() for move
// variation; they MUST be the same instance, so the swapped policy shares the host's retry state.
const h = () => (globalThis as any).__hostSeam.retry as typeof import("../retry");

export const resetRetry = (...a: Parameters<typeof import("../retry").resetRetry>) => h().resetRetry(...a);
export const retriesTaken = (...a: Parameters<typeof import("../retry").retriesTaken>) => h().retriesTaken(...a);
export const noteWave = (...a: Parameters<typeof import("../retry").noteWave>) => h().noteWave(...a);
export const shouldRetry = (...a: Parameters<typeof import("../retry").shouldRetry>) => h().shouldRetry(...a);
export const noteRetry = (...a: Parameters<typeof import("../retry").noteRetry>) => h().noteRetry(...a);
export const retryGeneration = (...a: Parameters<typeof import("../retry").retryGeneration>) => h().retryGeneration(...a);
