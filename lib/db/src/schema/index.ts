import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_username_unique").on(table.username),
    uniqueIndex("users_email_unique").on(table.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const posts = pgTable(
  "posts",
  {
    id: text("id").primaryKey(),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    type: text("type", { enum: ["discuss", "ask", "show"] }).notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    url: text("url"),
    score: integer("score").default(0).notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("posts_created_at_idx").on(table.createdAt),
    index("posts_score_idx").on(table.score),
    index("posts_type_created_at_idx").on(table.type, table.createdAt),
    index("posts_author_id_idx").on(table.authorId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => users.id),
    parentId: text("parent_id"),
    content: text("content").notNull(),
    score: integer("score").default(0).notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("comments_post_id_idx").on(table.postId),
    index("comments_parent_id_idx").on(table.parentId),
    index("comments_author_id_idx").on(table.authorId),
  ],
);

export const votes = pgTable(
  "votes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    postId: text("post_id").references(() => posts.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("votes_user_post_unique").on(table.userId, table.postId),
    uniqueIndex("votes_user_comment_unique").on(table.userId, table.commentId),
    index("votes_post_id_idx").on(table.postId),
    index("votes_comment_id_idx").on(table.commentId),
  ],
);

export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    fileSize: integer("file_size").notNull(),
    width: integer("width"),
    height: integer("height"),
    altText: text("alt_text").default("").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("media_post_id_idx").on(table.postId)],
);

export const reports = pgTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id),
    targetType: text("target_type", { enum: ["post", "comment"] }).notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason", { enum: ["spam", "harassment", "illegal", "nsfw", "other"] }).notNull(),
    details: text("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("reports_target_idx").on(table.targetType, table.targetId)],
);

export const userRelations = relations(users, ({ many }) => ({
  posts: many(posts),
  comments: many(comments),
  sessions: many(sessions),
}));

export const postRelations = relations(posts, ({ one, many }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
  comments: many(comments),
  media: many(media),
}));

export const commentRelations = relations(comments, ({ one }) => ({
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  post: one(posts, { fields: [comments.postId], references: [posts.id] }),
}));

export type User = typeof users.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type Comment = typeof comments.$inferSelect;