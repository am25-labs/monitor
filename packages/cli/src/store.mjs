import { chmod, mkdir, readFile, readdir, rename, rm, writeFile, open, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { CliError, requireValue } from "./messages.mjs";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function exists(path) {
  try { await lstat(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function writeJson(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export class Store {
  constructor(directory) {
    this.root = resolve(directory);
    this.directory = join(this.root, ".monitor");
    this.statePath = join(this.directory, "installation.json");
    this.secretsPath = join(this.directory, "secrets.json");
  }

  async initialize() {
    await mkdir(this.root, { recursive: true });
    if (await exists(this.directory)) {
      requireValue(!(await lstat(this.directory)).isSymbolicLink(), "La carpeta .monitor no puede ser un enlace simbólico.", ".monitor cannot be a symbolic link.");
      await this.load();
      return;
    }
    const files = await readdir(this.root);
    requireValue(files.every((file) => [".git", ".gitignore"].includes(file)), "La carpeta debe estar vacía. Usá otra carpeta para instalar o adoptar Monitor.", "The directory must be empty. Use another directory to install or adopt Monitor.");
    await mkdir(this.directory, { mode: 0o700 });
    await chmod(this.directory, 0o700);
    await writeFile(join(this.directory, ".gitignore"), "*\n", { mode: 0o600 });
    await this.save({ format: 1, id: randomUUID(), phase: "setup", resources: {} });
  }

  async load() {
    let state;
    try {
      requireValue(!(await lstat(this.directory)).isSymbolicLink() && !(await lstat(this.statePath)).isSymbolicLink(), "La instalación no puede usar enlaces simbólicos para su estado.", "Installation state cannot use symbolic links.");
      state = await readJson(this.statePath);
    }
    catch (error) {
      if (error.code === "ENOENT") throw new CliError("No hay una instalación en esta carpeta. Ejecutá init primero.", "No installation in this directory. Run init first.");
      throw error;
    }
    requireValue(state.format === 1 && typeof state.id === "string" && state.resources, "Formato de instalación desconocido.", "Unsupported installation format.");
    for (const version of [state.deployedVersion, state.targetVersion, state.operation?.target].filter(Boolean))
      requireValue(/^\d+\.\d+\.\d+$/.test(version), "La instalación contiene una versión inválida.", "Installation contains an invalid version.");
    return state;
  }

  async save(state) { await writeJson(this.statePath, state); }

  async secrets() {
    requireValue(!(await lstat(this.secretsPath)).isSymbolicLink(), "El archivo de secretos no puede ser un enlace simbólico.", "The secrets file cannot be a symbolic link.");
    await chmod(this.secretsPath, 0o600);
    const secrets = await readJson(this.secretsPath);
    requireValue(/^[a-f\d]{64}$/i.test(secrets.CONFIG_KEY ?? "") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(secrets.ACCESS_EMAIL ?? ""), "La llave o el correo guardados no son válidos. Recuperá el respaldo original.", "Invalid stored key or email. Recover the original backup.");
    return secrets;
  }

  async lock() {
    const path = join(this.directory, "operation.lock");
    let file;
    try { file = await open(path, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") throw new CliError("Hay una operación en curso. Si fue interrumpida, verificá que terminó y eliminá .monitor/operation.lock.", "Another operation is running. If interrupted, verify it has stopped and remove .monitor/operation.lock.");
      throw error;
    }
    await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return async () => { await file.close(); await rm(path, { force: true }); };
  }
}
