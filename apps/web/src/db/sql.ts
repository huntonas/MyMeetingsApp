import { type SQL, sql } from "drizzle-orm";

// Renders a fixed list of code constants as SQL string literals. Never pass user input.
export function sqlStringList(values: readonly string[]): SQL {
  if (values.some((value) => !/^[a-z_]+$/.test(value))) {
    throw new Error(`sqlStringList only accepts lowercase identifiers: ${values.join(", ")}`);
  }
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

// node-postgres doesn't bind a JS array as a Postgres array literal through sql``, so build one
// explicitly from individually bound, cast parameters. Postgres needs an explicit cast for an empty array.
export function sqlArray(values: readonly string[], type: "uuid" | "text"): SQL {
  if (values.length === 0) return sql.raw(`array[]::${type}[]`);
  return sql`array[${sql.join(
    values.map((value) => sql`${value}::${sql.raw(type)}`),
    sql`, `,
  )}]`;
}
