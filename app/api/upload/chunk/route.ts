import fs from "fs/promises";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { documents } from "@/db/schema";
import {
  ensureUploadDirs,
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
  try {
    const token = extractToken(request);
    if (!token) {
      return NextResponse.json({ error: "Missing token" }, { status: 401 });
    }

    let payload;
    try {
      payload = verifyUploadToken(token);
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }
    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.length === 0) {
      return NextResponse.json({ error: "Empty chunk" }, { status: 400 });
    }

    const doc = await db.query.documents.findFirst({
      where: and(
        eq(documents.id, payload.docId),
        eq(documents.sessionId, payload.sessionId),
      ),
    });

    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.status === "processing" || doc.status === "ready") {
      return NextResponse.json(
        { error: "Upload already completed or processing" },
        { status: 409 },
      );
    }

    await ensureUploadDirs();
    const tempPath = getTempFilePath(payload);
    await fs.appendFile(tempPath, buffer);
    const stats = await fs.stat(tempPath);

    if (Number(stats.size) > MAX_UPLOAD_BYTES) {
      await fs.rm(tempPath, { force: true });
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

    await db
      .update(documents)
      .set({
        status: "uploading",
        sizeBytes: Number(stats.size),
        updatedAt: new Date(),
      })
      .where(eq(documents.id, payload.docId));

    return NextResponse.json({
      receivedBytes: buffer.length,
      totalBytes: Number(stats.size),
    });
  } catch (error) {
    console.error("[upload/chunk] error", error);
    return NextResponse.json({ error: "Failed to append chunk" }, { status: 500 });
  }
}
