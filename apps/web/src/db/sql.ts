import { type SQL, sql } from "drizzle-orm";

// Renders a fixed list of code constants as SQL string literals. Never pass user input.
export function sqlStringList(values: readonly string[]): SQL {
  if (values.some((value) => !/^[a-z_]+$/.test(value))) {
    throw new Error(`sqlStringList only accepts lowercase identifiers: ${values.join(", ")}`);
  }
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}
