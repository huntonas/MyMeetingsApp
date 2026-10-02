import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError } from "pg";

// Query parameters can carry coordinates, device IDs and feed content. Drizzle puts them in its error
// message, and the database's own message and detail can quote an offending value, so for database errors
// only the SQL text and the database's structured fields are logged.
function describeError(error: unknown): string {
  if (error instanceof DrizzleQueryError) {
    return `database query failed: ${error.query}\ncaused by: ${describeError(error.cause)}`;
  }
  if (error instanceof DatabaseError) {
    const { code, severity, constraint, table, column, routine } = error;
    return `database error ${JSON.stringify({ code, severity, constraint, table, column, routine })}`;
  }
  // The stack only, never util.inspect: an error's cause (fetch's, say) can carry request details, and only inspect
  // prints it.
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

// The one way to log a failure. The context names what failed and never includes request or feed data.
export function logError(context: string, error: unknown): void {
  console.error(`${context}:`, describeError(error));
}
