import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.local.jsonc" },
      miniflare: {
        assets: {
          directory: "./tests/fixtures/assets",
          binding: "ASSETS",
          assetConfig: { html_handling: "auto-trailing-slash" },
        },
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          CONFIG_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    })),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
