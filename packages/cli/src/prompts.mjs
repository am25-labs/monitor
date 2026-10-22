import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";
import { Cancelled, CliError, translator } from "./messages.mjs";

export class Prompts {
  constructor(language = "es") {
    this.language = language;
    this.t = translator(language);
  }

  log(es, en = es) {
    stdout.write(`${this.t(es, en)}\n`);
  }

  async text(es, en, { fallback = "", validate = () => true } = {}) {
    if (!stdin.isTTY) throw new CliError("Este paso requiere una terminal interactiva.", "This step requires an interactive terminal.");
    while (true) {
      const input = createInterface({ input: stdin, output: stdout });
      const controller = new AbortController();
      const cancel = () => controller.abort();
      input.on("SIGINT", cancel);
      let value;
      try {
        value = (await input.question(`${this.t(es, en)}${fallback ? ` [${fallback}]` : ""}: `, { signal: controller.signal })).trim() || fallback;
      } catch {
        throw new Cancelled();
      } finally {
        input.close();
      }
      if (validate(value)) return value;
      this.log("El valor no es válido. Intentá de nuevo.", "Invalid value. Try again.");
    }
  }

  async choose(es, en, options) {
    if (!options.length) throw new CliError("No hay opciones disponibles para esta cuenta.", "No options are available for this account.");
    options.forEach((option, index) => this.log(`  ${index + 1}. ${option.label}`));
    const value = await this.text(es, en, {
      fallback: "1",
      validate: (answer) => /^\d+$/.test(answer) && Number(answer) >= 1 && Number(answer) <= options.length
    });
    return options[Number(value) - 1].value;
  }

  async confirm(es, en) {
    const value = await this.text(`${es} (s/n)`, `${en} (y/n)`, {
      fallback: "n", validate: (answer) => /^(s|y|n)$/i.test(answer)
    });
    if (!/^(s|y)$/i.test(value)) throw new Cancelled();
  }

  async secret(es, en) {
    if (!stdin.isTTY) throw new CliError("Usá una terminal interactiva para ingresar secretos.", "Use an interactive terminal to enter secrets.");
    stdout.write(`${this.t(es, en)}: `);
    emitKeypressEvents(stdin);
    const previousRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    return new Promise((resolve, reject) => {
      let value = "";
      const finish = (error) => {
        stdin.removeListener("keypress", onKey);
        stdin.setRawMode(previousRaw ?? false);
        stdin.pause();
        stdout.write("\n");
        if (error) reject(error);
        else resolve(value.trim());
      };
      const onKey = (character, key) => {
        if (key?.ctrl && key.name === "c") return finish(new Cancelled());
        if (key?.name === "return" || key?.name === "enter") return finish();
        if (key?.name === "backspace") value = value.slice(0, -1);
        else if (character && !key?.ctrl && !key?.meta && !/[\x00-\x1f\x7f]/.test(character)) value += character;
      };
      stdin.on("keypress", onKey);
    });
  }
}
