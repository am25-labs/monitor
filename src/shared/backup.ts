import { z } from "zod";
import schema from "../../docs/data-export.schema.json";

export const backupLimit = 20 * 1024 * 1024;
export const backupTables = schema.$defs.fullData.required;
export const projectTables = schema.$defs.projectData.required;
export type BackupRow = Record<string, string | number | null>;

const backupInput = z.object({
  format: z.literal("am25-monitor"),
  formatVersion: z.literal(1),
  appVersion: z.string(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  consistency: z.literal("live"),
  credentials: z.literal("encrypted-with-original-CONFIG_KEY"),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("full") }).strict(),
    z.object({ type: z.literal("projects"), projectIds: z.array(z.uuid()).min(1) }).strict()
  ]),
  schema: z.array(z.object({ type: z.string(), name: z.string(), tbl_name: z.string(), sql: z.string() }).strict()),
  data: z.record(z.string(), z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))))
}).strict();

export function parseBackup(input: unknown) {
  const parsed = backupInput.safeParse(input);
  if (!parsed.success) throw new Error("La copia no es un JSON de Monitor completo y compatible.");
  const backup = parsed.data;
  const tables = backup.scope.type === "full" ? backupTables : projectTables;
  const definitions = schema.$defs as Record<string, { required: string[]; properties: Record<string, { type: string | string[] }> }>;
  if (Object.keys(backup.data).length !== tables.length || tables.some((table) => !backup.data[table]))
    throw new Error("La copia no es un JSON de Monitor completo y compatible.");
  for (const table of tables) {
    const definition = definitions[table];
    for (const row of backup.data[table]) {
      if (Object.keys(row).length !== definition.required.length || definition.required.some((column) => !Object.hasOwn(row, column)))
        throw new Error("La copia no es un JSON de Monitor completo y compatible.");
      for (const [column, value] of Object.entries(row)) {
        const expected = definition.properties[column].type;
        const types = typeof expected === "string" ? [expected] : expected;
        const actual = value === null ? "null" : typeof value === "number" && Number.isInteger(value) ? "integer" : typeof value;
        if (!types.includes(actual) && !(actual === "integer" && types.includes("number")))
          throw new Error("La copia no es un JSON de Monitor completo y compatible.");
      }
    }
  }
  const ids = backup.data.projects.map((project) => project.id);
  if (ids.some((id) => !z.uuid().safeParse(id).success) || new Set(ids).size !== ids.length ||
    (backup.scope.type === "projects" && (new Set(backup.scope.projectIds).size !== ids.length || backup.scope.projectIds.some((id) => !ids.includes(id)))))
    throw new Error("Los proyectos de la copia no coinciden con su alcance.");
  return backup;
}

export type Backup = ReturnType<typeof parseBackup>;
