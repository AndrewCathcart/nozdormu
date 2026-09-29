import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./packages/db/src/global-setup.ts"],
  },
});
