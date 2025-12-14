import fs from "fs/promises";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { documents } from "@/db/schema";
import { processDocument } from "@/worker/process-document";
import {
  ensureUploadDirs,
  getFinalFilePath,
  getTempFilePath,
  verifyUploadToken,
} from "@/lib/upload";

export const runtime = "nodejs";
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

function extractToken(request: Request) {
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token");
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  return queryToken ?? bearer;
}

export async function POST(request: Request) {
  let docIdForFailure: number | null = null;
  try {
    const token = extractToken(request);
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    let payload;
    try {
      payload = verifyUploadToken(token);
      docIdForFailure = payload.docId;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    const { filename } = body ?? {};

    const doc = await db.query.documents.findFirst({
      where: and(
        eq(documents.id, payload.docId),
        eq(documents.sessionId, payload.sessionId),
      ),
    });

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }

    await ensureUploadDirs();
    const tempPath = getTempFilePath(payload);
    const finalPath = getFinalFilePath(payload, filename);

    const exists = await fs
      .stat(tempPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return NextResponse.json({ error: "Upload not found" }, { status: 400 });
    }

    await fs.rm(finalPath, { force: true });
    await fs.rename(tempPath, finalPath);
    const stats = await fs.stat(finalPath);

    if (Number(stats.size) > MAX_UPLOAD_BYTES) {
      await fs.rm(finalPath, { force: true });
      await db
        .update(documents)
        .set({
          status: "failed",
          metadata: { ...(doc.metadata ?? {}), error: "max upload size exceeded" },
          updatedAt: new Date(),
        })
        .where(eq(documents.id, payload.docId));
      return NextResponse.json({ error: "max upload size exceeded" }, { status: 413 });
    }

    const [updatedDoc] = await db
      .update(documents)
      .set({
        status: "processing",
        filePath: finalPath,
        sizeBytes: Number(stats.size),
        uploadCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, payload.docId))
      .returning();

    // Kick off background processing so the client can poll for status.
    void processDocument(updatedDoc.id).catch(async (error) => {
      console.error("[upload/complete] processing failed", error);
      const metadata = (updatedDoc.metadata as Record<string, unknown> | null) ?? {};
      await db
        .update(documents)
        .set({
          status: "failed",
          metadata: { ...metadata, error: error instanceof Error ? error.message : String(error) },
          updatedAt: new Date(),
        })
        .where(eq(documents.id, updatedDoc.id));
    });

    return NextResponse.json({
      ok: true,
      docId: updatedDoc.id,
      sizeBytes: Number(stats.size),
      status: "processing",
    });
  } catch (error) {
    console.error("[upload/complete] error", error);
    const message = error instanceof Error ? error.message : String(error);
    // Mark doc as failed if we know which one this was for better visibility.
    if (typeof docIdForFailure === "number") {
      await db
        .update(documents)
        .set({
          status: "failed",
          metadata: { error: message },
          updatedAt: new Date(),
        })
        .where(eq(documents.id, docIdForFailure));
    }
    return NextResponse.json(
      { error: "Failed to finalize upload" },
      { status: 500 },
    );
  }
}
