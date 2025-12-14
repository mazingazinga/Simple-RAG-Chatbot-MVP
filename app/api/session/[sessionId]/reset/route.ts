import fs from "fs/promises";
import path from "path";

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { documents, messages, sessions } from "@/db/schema";

export const runtime = "nodejs";

const UPLOAD_DIR = path.join(process.cwd(), "tmp", "uploads");
const FILES_DIR = path.join(process.cwd(), "tmp", "files");

async function removeDocFiles(docIds: number[]) {
  if (docIds.length === 0) return;
  const tasks: Promise<unknown>[] = [];

  for (const id of docIds) {
    const uploadGlob = path.join(UPLOAD_DIR, `${id}-*.part`);
    const fileGlob = path.join(FILES_DIR, `doc-${id}-*`);
    tasks.push(
      fs.rm(uploadGlob, { force: true }).catch(() => undefined),
      fs.rm(fileGlob, { force: true }).catch(() => undefined),
    );
  }

  await Promise.all(tasks);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const { sessionId: sessionIdRaw } = await params;
    const sessionId = Number(sessionIdRaw);
    if (!sessionId || !Number.isFinite(sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const session = await db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    let clearedMessages = 0;
    let clearedDocuments = 0;
    let deletedDocIds: number[] = [];

    await db.transaction(async (tx) => {
      const deletedMessages = await tx
        .delete(messages)
        .where(eq(messages.sessionId, sessionId))
        .returning({ id: messages.id });
      clearedMessages = deletedMessages.length;

      const deletedDocs = await tx
        .delete(documents)
        .where(and(eq(documents.sessionId, sessionId)))
        .returning({ id: documents.id });
      clearedDocuments = deletedDocs.length;
      deletedDocIds = deletedDocs.map((d) => d.id);

      await tx
        .update(sessions)
        .set({ activeDocumentId: null, updatedAt: new Date() })
        .where(eq(sessions.id, sessionId));
    });

    // Fire-and-forget file cleanup; no need to block response.
    void removeDocFiles(deletedDocIds);

    return NextResponse.json(
      {
        sessionId,
        clearedMessages,
        clearedDocuments,
        note: "Reset clears documents, embeddings, and chat history for this session.",
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[session reset] error", error);
    return NextResponse.json({ error: "Failed to reset session" }, { status: 500 });
  }
}
