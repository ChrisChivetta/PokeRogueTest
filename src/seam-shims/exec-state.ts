// HOT-BUNDLE SHIM for ./exec-state — forwards to the HOST's live starter-select state singleton.
// CRITICAL: the host bundle owns the one true `execState` object; the swapped strategy bundle must
// mutate THAT object (not a fresh copy) so an in-progress starter-select survives the hot swap.
const h = () => (globalThis as any).__hostSeam.execState as typeof import("../exec-state");

// `execState` is a live object — return the host's instance directly (do NOT snapshot it).
export const execState = new Proxy({} as import("../exec-state").ExecState, {
  get: (_t, k) => (h().execState as any)[k],
  set: (_t, k, v) => {
    (h().execState as any)[k] = v;
    return true;
  },
});

export const resetExecState = (...a: Parameters<typeof import("../exec-state").resetExecState>) =>
  h().resetExecState(...a);
