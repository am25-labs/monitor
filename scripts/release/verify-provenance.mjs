import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { createHash } from "node:crypto";
import { readJson } from "../../packages/cli/src/store.mjs";
import { requireValue } from "../../packages/cli/src/messages.mjs";
import { assertPublishEnvironment } from "../../packages/cli/src/publish-guard.mjs";
import { assertArtifactIntegrity, matchesProvenance, readRegistryJson } from "./provenance.mjs";

const pkg = await readJson(new URL("../../packages/cli/package.json", import.meta.url));
assertPublishEnvironment(process.env, pkg.version);
const artifact = await readFile(resolve(process.argv[2]));
const integrity = `sha512-${createHash("sha512").update(artifact).digest("base64")}`;
const digest = createHash("sha512").update(artifact).digest("hex");
const npmRoot = execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim();
const npmRequire = createRequire(join(npmRoot, "npm/package.json"));
const { verify } = npmRequire("sigstore");
let verified = false;
for (let attempt = 0; attempt < 6; attempt++) {
  console.log(`Verifying published provenance (attempt ${attempt + 1}/6).`);
  const published = await readRegistryJson(`https://registry.npmjs.org/@am25%2fmonitor/${pkg.version}`);
  if (published) {
    assertArtifactIntegrity(published, { sha: process.env.GITHUB_SHA, integrity });
    const url = published.dist?.attestations?.url;
    if (url) {
      requireValue(new URL(url).origin === "https://registry.npmjs.org", "Origen de atestación inválido.", "Invalid attestation origin.");
      const data = await readRegistryJson(url);
      if (data) {
        const attestations = data.attestations ?? [];
        const matching = attestations.find((item) => matchesProvenance(item.bundle, { version: pkg.version, sha: process.env.GITHUB_SHA, digest }));
        if (matching) {
          await verify(matching.bundle, {
            certificateIssuer: "https://token.actions.githubusercontent.com",
            certificateIdentityURI: `https://github.com/am25-labs/monitor/.github/workflows/publish.yml@refs/tags/${pkg.version}`
          });
          verified = true;
        }
        if (verified) break;
      }
    }
  }
  if (attempt < 5) await setTimeout(10000);
}
requireValue(verified, "No se confirmó provenance del repositorio y commit esperados. Revisá la publicación en npm; no se volverá a publicar la versión.", "Could not confirm provenance for the expected repository and commit. Review npm; this version will not be republished.");
console.log(`Verified npm provenance: ${pkg.name}@${pkg.version} (${process.env.GITHUB_SHA})`);
