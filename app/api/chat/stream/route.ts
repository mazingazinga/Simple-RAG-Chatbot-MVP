import { NextResponse } from "next/server";
import OpenAI from "openai";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { chunks, documents, messages, sessions } from "@/db/schema";
import { embedText } from "@/lib/embeddings";

export const runtime = "nodejs";

const TOP_K_DEFAULT = 5;

type CitationsPayload = Array<{
  id: number;
  content: string;
  score: number;
  pageStart?: number;
  pageEnd?: number;
  metadata?: Record<string, unknown>;
}>;

function textEncoder() {
  return new TextEncoder();
}

function sendSse(controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) {
  const encoder = textEncoder();
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

async function fetchActiveDocument(sessionId: number) {
  const session = await db.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });

  if (!session?.activeDocumentId) {
    throw new Error("No active document for session");
  }

  const doc = await db.query.documents.findFirst({
    where: and(
      eq(documents.id, session.activeDocumentId),
      eq(documents.sessionId, sessionId),
    ),
  });

  if (!doc) {
    throw new Error("Active document not found");
  }

  if (doc.status !== "ready") {
    throw new Error("Active document is not ready");
  }

  return doc;
}

function vectorLiteral(vector: number[]) {
  return sql.raw(`'[${vector.map((v) => Number(v).toFixed(6)).join(",")}]'`);
}

async function searchChunks(docId: number, vector: number[], topK: number) {
  const v = vectorLiteral(vector);
  const { rows } = await db.execute(
    sql`
      SELECT id, content, metadata, (embedding <=> ${v}::vector) AS distance
      FROM ${chunks}
      WHERE ${chunks.documentId} = ${docId}
      ORDER BY embedding <=> ${v}::vector ASC
      LIMIT ${topK};
    `,
  );

  return rows.map((row) => {
    const metadata = (row as { metadata?: Record<string, unknown> }).metadata ?? {};
    return {
      id: Number((row as { id: number }).id),
      content: String((row as { content: string }).content),
      score: Number((row as { distance: number }).distance),
      metadata,
      pageStart: (metadata as Record<string, unknown>)["pageStart"] as number | undefined,
      pageEnd: (metadata as Record<string, unknown>)["pageEnd"] as number | undefined,
    };
  });
}

function buildPrompt(question: string, citations: CitationsPayload) {
  const context = citations
    .map(
      (c, idx) =>
        `[[${idx + 1}]] (score: ${c.score.toFixed(4)}) pages ${c.pageStart ?? "?"}-${
          c.pageEnd ?? "?"
        }:\n${c.content}`,
    )
    .join("\n\n");

  return [
    {
      role: "system" as const,
      content:
        "You are a helpful assistant for a Retrieval-Augmented Generation (RAG) system. Answer only from the provided context. If the context is insufficient, say you do not have enough information. Keep answers concise and cite sources like [1], [2] based on the provided chunks.",
    },
    {
      role: "user" as const,
      content: `Question: ${question}\n\nContext:\n${context}`,
    },
  ];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = Number(body.sessionId);
    const question = String(body.question ?? "").trim();
    const topK = Math.min(Number(body.topK ?? TOP_K_DEFAULT) || TOP_K_DEFAULT, 10);

    if (!sessionId || !Number.isFinite(sessionId)) {
      return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
    }
    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not set. Add it to .env.local to enable chat." },
        { status: 400 },
      );
    }
    const client = new OpenAI({ apiKey: openaiApiKey });

    const doc = await fetchActiveDocument(sessionId);
    const questionVector = await embedText(question);
    const citations = await searchChunks(doc.id, questionVector, topK);
    if (citations.length === 0) {
      return NextResponse.json(
        { error: "Document has no indexed chunks yet. Re-upload or retry processing." },
        { status: 400 },
      );
    }

    const encoder = new TextEncoder();
    let fullText = "";

    const stream = new ReadableStream({
      async start(controller) {
        sendSse(controller, { type: "start" });
        const prompt = buildPrompt(question, citations);

        const response = await client.responses.create({
          model: "gpt-4.1-mini",
          stream: true,
          input: prompt,
        });

        for await (const event of response) {
          if (
            event.type === "response.output_text.delta" &&
            typeof event.delta === "string"
          ) {
            fullText += event.delta;
            controller.enqueue(encoder.encode(`data: ${event.delta}\n\n`));
          }
        }

        sendSse(controller, { type: "citations", citations });

        await db.transaction(async (tx) => {
          await tx.insert(messages).values({
            sessionId,
            role: "user",
            content: question,
            metadata: { docId: doc.id },
          });

          await tx.insert(messages).values({
            sessionId,
            role: "assistant",
            content: fullText,
            metadata: { docId: doc.id, citations },
          });
        });

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[chat/stream] error", error);
    return NextResponse.json({ error: "Failed to stream chat" }, { status: 500 });
  }
}
