import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { documents, messages, sessions } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(
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

    const activeDoc = session.activeDocumentId
      ? await db.query.documents.findFirst({
          where: and(
            eq(documents.id, session.activeDocumentId),
            eq(documents.sessionId, sessionId),
          ),
        })
      : null;

    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt);

    return NextResponse.json({
      session,
      activeDocument: activeDoc,
      messages: history,
    });
  } catch (error) {
    console.error("[session GET] error", error);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
}
