import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const [tree] = JSON.parse(execFileSync("pnpm", ["list", "--depth", "Infinity", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}));
const packages = new Map();

function licenseName(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(licenseName).join(" OR ");
  return value?.type ?? "No declarada";
}

function collect(node) {
  for (const group of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const dependency of Object.values(node[group] ?? {})) {
      if (!existsSync(resolve(dependency.path, "package.json"))) continue;
      const pkg = JSON.parse(readFileSync(resolve(dependency.path, "package.json"), "utf8"));
      if (!pkg.name.startsWith("@am25/")) {
        const key = `${pkg.name}@${pkg.version}`;
        if (!packages.has(key)) {
          const files = readdirSync(dependency.path, { withFileTypes: true })
            .filter((entry) => entry.isFile() && /^(license|licence|notice|copying|copyright)(\.|$|-)/i.test(entry.name));
          packages.set(key, {
            name: pkg.name,
            version: pkg.version,
            license: licenseName(pkg.license ?? pkg.licenses),
            notices: files.map((entry) => `${entry.name}\n\n${readFileSync(resolve(dependency.path, entry.name), "utf8")}`),
          });
        }
      }
      collect(dependency);
    }
  }
}

collect(tree);
const sorted = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
const directPackages = new Set([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)].map((name) => {
  const pkg = JSON.parse(readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8"));
  return `${pkg.name}@${pkg.version}`;
}));
const dependencies = sorted.filter((pkg) => directPackages.has(`${pkg.name}@${pkg.version}`))
  .map(({ name, version, license }) => ({ name, version, license }));

writeFileSync(resolve(root, "src/lib/third-party-software.json"), `${JSON.stringify({ dependencies, packageCount: sorted.length }, null, 2)}\n`);
const notices = sorted.map((pkg) => [
  `${pkg.name} ${pkg.version}`,
  `License: ${pkg.license}`,
  ...pkg.notices,
].join("\n\n")).join("\n\n------------------------------------------------------------\n\n");
writeFileSync(resolve(root, "public/assets/third-party-notices.txt"), `Monitor by AM25 - Third-party software notices\n\nInstalled direct and transitive dependencies, including development tools.\n\n${notices}\n`);
console.log(`Generated notices for ${sorted.length} packages and ${dependencies.length} direct dependencies`);
