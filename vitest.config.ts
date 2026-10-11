import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.local.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          CONFIG_KEY:
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
          POSTMARK_TOKEN: "intercepted",
        },
      },
    })),
  ],
  test: { include: ["tests/**/*.test.ts"] },
});
