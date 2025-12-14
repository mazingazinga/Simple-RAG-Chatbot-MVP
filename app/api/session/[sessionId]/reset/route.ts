import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { documents, messages, sessions } from "@/db/schema";

export const runtime = "nodejs";

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

    await db.transaction(async (tx) => {
      const deletedMessages = await tx
        .delete(messages)
        .where(eq(messages.sessionId, sessionId))
        .returning({ id: messages.id });
      clearedMessages = deletedMessages.length;

      const deletedDocs = await tx
        .delete(documents)
        .where(eq(documents.sessionId, sessionId))
        .returning({ id: documents.id });
      clearedDocuments = deletedDocs.length;

      await tx
        .update(sessions)
        .set({ activeDocumentId: null, updatedAt: new Date() })
        .where(eq(sessions.id, sessionId));
    });

    return NextResponse.json({
      sessionId,
      clearedMessages,
      clearedDocuments,
    });
  } catch (error) {
    console.error("[session reset] error", error);
    return NextResponse.json({ error: "Failed to reset session" }, { status: 500 });
  }
}
