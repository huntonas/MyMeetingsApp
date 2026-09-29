import { z } from "zod";

// An admin search box's value from the query string. Missing, repeated or longer than 100 characters reads as no
// query, so a crafted URL can't send an unbounded pattern to the database.
const SearchQuery = z.string().trim().max(100).catch("");

export function searchQuery(value: string | string[] | undefined): string {
  return SearchQuery.parse(value);
}
