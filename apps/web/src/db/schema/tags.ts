import { TAG_CATEGORIES } from "@mymeetingapp/shared";
import { sql } from "drizzle-orm";
import { check, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

import { sqlStringList } from "@/db/sql";

const TAG_STATUSES = ["active", "retired"] as const;

// Tags are never deleted; a retired tag keeps its history.
export const tags = pgTable(
  "tags",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    label: text("label").notNull(),
    category: text("category", { enum: TAG_CATEGORIES }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    status: text("status", { enum: TAG_STATUSES }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("tags_category_check", sql`${table.category} in (${sqlStringList(TAG_CATEGORIES)})`),
    check("tags_status_check", sql`${table.status} in (${sqlStringList(TAG_STATUSES)})`),
  ],
);
