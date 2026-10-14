import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Cold imports of server modules (SDKs, Prisma) can exceed the 5 s default under parallel load.
    testTimeout: 30_000,
  },
});
