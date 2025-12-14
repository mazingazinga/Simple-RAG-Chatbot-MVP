import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const DEFAULT_EMBEDDING_DIM = 1536;

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "uploading",
  "processing",
  "ready",
  "failed",
]);

export const sessions = pgTable("sessions", {
  id: serial("id").primaryKey(),
  title: varchar("title", { length: 256 }).notNull().default("Untitled Session"),
  activeDocumentId: integer("active_document_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 256 }).notNull(),
    content: text("content").notNull().default(""),
    embedding: vector("embedding", { dimensions: DEFAULT_EMBEDDING_DIM }).$type<
      number[] | null
    >(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    status: documentStatusEnum("status").notNull().default("pending"),
    filePath: text("file_path"),
    sizeBytes: integer("size_bytes"),
    uploadCompletedAt: timestamp("upload_completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIndex: index("documents_session_idx").on(table.sessionId),
    embeddingIndex: index("documents_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_l2_ops"),
    ),
  }),
);

export const chunks = pgTable(
  "chunks",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: DEFAULT_EMBEDDING_DIM }).notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    documentIndex: index("chunks_document_idx").on(table.documentId),
    embeddingIndex: index("chunks_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_l2_ops"),
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sessionIndex: index("messages_session_idx").on(table.sessionId),
  }),
);
