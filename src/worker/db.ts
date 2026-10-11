export async function rows<T>(
  db: D1Database,
  sql: string,
  ...args: unknown[]
): Promise<T[]> {
  return (
    await db
      .prepare(sql)
      .bind(...args)
      .all<T>()
  ).results;
}
export function statement(db: D1Database, sql: string, ...args: unknown[]) {
  return db.prepare(sql).bind(...args);
}
export async function first<T>(
  db: D1Database,
  sql: string,
  ...args: unknown[]
) {
  return db
    .prepare(sql)
    .bind(...args)
    .first<T>();
}
export const nowSeconds = () => Math.floor(Date.now() / 1000);
