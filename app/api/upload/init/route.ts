import fs from "fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { createSession } from "@/db/queries";
import { documents, messages, sessions } from "@/db/schema";
import {
  ensureUploadDirs,
  getTempFilePath,
  makeUploadToken,
  verifyUploadToken,
} from "@/lib/upload";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      title = "Uploaded Document",
      sessionId,
      filename,
      sizeBytes,
      metadata = {},
    } = body ?? {};

    if (typeof sizeBytes === "number" && sizeBytes > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "max upload size exceeded" }, { status: 413 });
    }

    const session =
      typeof sessionId === "number"
        ? { id: sessionId }
        : await createSession({ title: "Upload Session" });

    const [doc] = await db
      .insert(documents)
      .values({
        sessionId: session.id,
        title,
        content: "",
        metadata: { filename, ...metadata, sizeBytes },
        status: "uploading",
        sizeBytes,
      })
      .returning();

    // Make this the active document for the session right away so the UI can reflect status.
    await db
      .update(sessions)
      .set({ activeDocumentId: doc.id, updatedAt: new Date() })
      .where(eq(sessions.id, session.id));

    // Reset chat history for this session when a new document is uploaded.
    await db.delete(messages).where(eq(messages.sessionId, session.id));

    const token = makeUploadToken(doc.id, session.id);

    const payload = verifyUploadToken(token);

    await ensureUploadDirs();
    const tempPath = getTempFilePath(payload);
    await fs.writeFile(tempPath, Buffer.alloc(0));

    return NextResponse.json({ ...payload, token });
  } catch (error) {
    console.error("[upload/init] error", error);
    return NextResponse.json({ error: "Failed to initialize upload" }, { status: 500 });
  }
}
