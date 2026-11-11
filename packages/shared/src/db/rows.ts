import type { z } from "zod";

// Postgres columns are snake_case, TypeScript fields are camelCase. Only the
// top-level keys are renamed: jsonb values are written by us in camelCase.
export function camelizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), value]),
  );
}

/** Renames columns to camelCase, then validates every row; throws on a row that doesn't fit. */
export function parseRows<S extends z.ZodType>(schema: S, rows: readonly Record<string, unknown>[]): z.infer<S>[] {
  return rows.map((row) => schema.parse(camelizeRow(row)));
}
