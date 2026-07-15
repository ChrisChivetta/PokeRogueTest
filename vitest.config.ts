import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tier 1 unit tests (tests/*.test.ts) run here with `npm test`.
    // Tier 2 integration tests (tests/integration/**) import PokéRogue's GameManager
    // and only resolve inside the PokéRogue checkout — run them via
    // `harness/integration.sh`, not the local runner.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/integration/**"],
  },
});
