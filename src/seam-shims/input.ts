// HOT-BUNDLE SHIM for ./input — forwards to the HOST bundle's live input singleton so the swapped
// policy sends through the SAME press() (one input path, shared actionsSent counter + press trace).
const h = () => (globalThis as any).__hostSeam.input as typeof import("../input");

export const press = (...a: Parameters<typeof import("../input").press>) => h().press(...a);
export const moveCursor2x2 = (...a: Parameters<typeof import("../input").moveCursor2x2>) => h().moveCursor2x2(...a);
export const sleep = (...a: Parameters<typeof import("../input").sleep>) => h().sleep(...a);
export const actionsSentCount = (...a: Parameters<typeof import("../input").actionsSentCount>) => h().actionsSentCount(...a);
export const recentPresses = (...a: Parameters<typeof import("../input").recentPresses>) => h().recentPresses(...a);
