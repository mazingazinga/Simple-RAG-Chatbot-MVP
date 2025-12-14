import { and, eq, inArray, lt } from "drizzle-orm";
import fs from "fs/promises";
import path from "path";

import { db } from "./index";
import { chunks, documents, sessions } from "./schema";

type CreateSessionInput = {
  title?: string;
};

type CreateDocumentInput = {
  sessionId: number;
  title: string;
  content?: string;
  embedding?: number[] | null;
  metadata?: Record<string, unknown>;
  status?: (typeof documents.$inferInsert)["status"];
  filePath?: string | null;
  sizeBytes?: number | null;
};

export async function createSession(input: CreateSessionInput = {}) {
  const { title = "Untitled Session" } = input;

  const [session] = await db
    .insert(sessions)
    .values({ title })
    .returning();

  return session;
}

export async function createDocument(input: CreateDocumentInput) {
  const {
    sessionId,
    title,
    content = "",
    embedding = null,
    metadata = {},
    status,
    filePath = null,
    sizeBytes = null,
  } = input;

  const [doc] = await db
    .insert(documents)
    .values({
      sessionId,
      title,
      content,
      embedding,
      metadata,
      status,
      filePath,
      sizeBytes,
    })
    .returning();

  return doc;
}

export async function setActiveDoc(sessionId: number, documentId: number) {
  const doc = await db.query.documents.findFirst({
    where: and(
      eq(documents.id, documentId),
      eq(documents.sessionId, sessionId),
    ),
  });

  if (!doc) {
    throw new Error("Document not found for this session");
  }

  const [session] = await db
    .update(sessions)
    .set({
      activeDocumentId: documentId,
      updatedAt: new Date(),
    })
    .where(eq(sessions.id, sessionId))
    .returning();

  return { doc, session };
}

export async function cleanupOldDoc(sessionId: number, olderThan: Date) {
  const staleDocs = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(eq(documents.sessionId, sessionId), lt(documents.createdAt, olderThan)),
    );

  const docIds = staleDocs.map((row) => row.id);
  if (docIds.length === 0) {
    return { deletedDocs: 0, deletedChunks: 0 };
  }

  const deletedChunks = await db
    .delete(chunks)
    .where(inArray(chunks.documentId, docIds))
    .returning({ id: chunks.id });

  const deletedDocs = await db
    .delete(documents)
    .where(inArray(documents.id, docIds))
    .returning({ id: documents.id });

  await db
    .update(sessions)
    .set({ activeDocumentId: null, updatedAt: new Date() })
    .where(
      and(eq(sessions.id, sessionId), inArray(sessions.activeDocumentId, docIds)),
    );

  // Best-effort file cleanup for deleted documents.
  const uploadDir = path.join(process.cwd(), "tmp", "uploads");
  const filesDir = path.join(process.cwd(), "tmp", "files");
  await Promise.all(
    docIds.flatMap((id) => [
      fs.rm(path.join(uploadDir, `${id}-*.part`), { force: true }).catch(() => undefined),
      fs.rm(path.join(filesDir, `doc-${id}-*`), { force: true }).catch(() => undefined),
    ]),
  );

  return {
    deletedDocs: deletedDocs.length,
    deletedChunks: deletedChunks.length,
  };
}
