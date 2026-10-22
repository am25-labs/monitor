export class CliError extends Error {
  constructor(es, en, options) {
    super(en, options);
    this.es = es;
    this.en = en;
  }
}

export class Cancelled extends CliError {
  constructor() {
    super("Operación cancelada. Podés reanudar con el mismo comando.", "Cancelled. Run the same command to resume.");
  }
}

export function translator(language) {
  return (es, en) => language === "en" ? en : es;
}

export function requireValue(condition, es, en) {
  if (!condition) throw new CliError(es, en);
}
