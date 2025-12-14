import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

import { eq } from "drizzle-orm";
import type {
  DocumentInitParameters,
  PDFPageProxy,
  TextItem,
} from "pdfjs-dist/types/src/display/api";

import { db } from "@/db";
import { chunks, documents, sessions } from "@/db/schema";
import { embedTexts } from "@/lib/embeddings";

type PageText = {
  pageNumber: number;
  text: string;
};

type ChunkPayload = {
  content: string;
  pageStart: number;
  pageEnd: number;
  chunkIndex: number;
};

const MAX_CHARS = 1400;
const MIN_CHARS = 600;
function groupTextItems(items: TextItem[]) {
  const rows: Array<{ y: number; entries: Array<{ x: number; str: string }> }> =
    [];
  const yTolerance = 2;

  items.forEach((item) => {
    const x = item.transform[4];
    const y = item.transform[5];
    const targetY = y;
    let row = rows.find((r) => Math.abs(r.y - targetY) <= yTolerance);
    if (!row) {
      row = { y: targetY, entries: [] };
      rows.push(row);
    }
    row.entries.push({ x, str: item.str });
  });

  rows.sort((a, b) => b.y - a.y);
  const lines = rows.map((row) => {
    const sorted = row.entries.sort((a, b) => a.x - b.x);
    return sorted.map((e) => e.str.trim()).filter(Boolean).join(" ");
  });

  return lines.filter(Boolean).join("\n");
}

async function extractPageText(
  page: PDFPageProxy,
  pageNumber: number,
) {
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((i): i is TextItem => "str" in i);
  const assembled = groupTextItems(items);
  return { pageNumber, text: assembled };
}

function hybridChunk(pages: PageText[]): ChunkPayload[] {
  const chunksPayload: ChunkPayload[] = [];
  if (pages.length === 0) return chunksPayload;

  let current = "";
  let startPage = pages[0]?.pageNumber ?? 1;
  let endPage = startPage;

  pages.forEach((page) => {
    const paragraphs = page.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    paragraphs.forEach((para, idx) => {
      const next = current.length === 0 ? para : `${current}\n\n${para}`;
      if (next.length > MAX_CHARS && current.length >= MIN_CHARS) {
        chunksPayload.push({
          content: current,
          pageStart: startPage,
          pageEnd: endPage,
          chunkIndex: chunksPayload.length,
        });
        current = para;
        startPage = page.pageNumber;
        endPage = page.pageNumber;
      } else {
        current = next;
        endPage = page.pageNumber;
      }

      // If last paragraph on last page
      const isLast =
        page === pages[pages.length - 1] &&
        idx === paragraphs.length - 1;
      if (isLast && current.trim().length > 0) {
        chunksPayload.push({
          content: current,
          pageStart: startPage,
          pageEnd: endPage,
          chunkIndex: chunksPayload.length,
        });
      }
    });
  });

  if (chunksPayload.length === 0 && current.trim().length > 0) {
    chunksPayload.push({
      content: current,
      pageStart: startPage,
      pageEnd: endPage,
      chunkIndex: 0,
    });
  }

  return chunksPayload;
}

export async function processDocument(docId: number) {
  process.env.PDFJS_DISABLE_WORKER = "true";
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerSrcPath = path.join(
    process.cwd(),
    "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  const globalOptions = pdfjsLib.GlobalWorkerOptions as typeof pdfjsLib.GlobalWorkerOptions & {
    disableWorker?: boolean;
  };
  globalOptions.workerSrc = pathToFileURL(workerSrcPath).toString();
  globalOptions.workerPort = null;
  // pdf.js type defs omit disableWorker; set it explicitly to avoid spawning a worker thread.
  globalOptions.disableWorker = true;

  const doc = await db.query.documents.findFirst({
    where: eq(documents.id, docId),
  });

  if (!doc) {
    throw new Error(`Document ${docId} not found`);
  }
  if (!doc.filePath) {
    throw new Error(`Document ${docId} missing file path for processing`);
  }

  const absolutePath = path.isAbsolute(doc.filePath)
    ? doc.filePath
    : path.join(process.cwd(), doc.filePath);
  const exists = await fs
    .stat(absolutePath)
    .then(() => true)
    .catch(() => false);
  if (!exists) {
    throw new Error(`File not found at ${absolutePath}`);
  }

  const pdfData = await fs.readFile(absolutePath);
  const pdfUint8 = new Uint8Array(pdfData.buffer, pdfData.byteOffset, pdfData.byteLength);
  const loadOptions: DocumentInitParameters & { disableWorker?: boolean } = {
    data: pdfUint8,
    useSystemFonts: true,
    disableWorker: true,
  };
  const pdf = await pdfjsLib.getDocument(loadOptions).promise;

  const pages: PageText[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const text = await extractPageText(page, i);
    pages.push(text);
  }

  let chunkPayloads = hybridChunk(pages);
  if (chunkPayloads.length === 0) {
    const combined = pages.map((p) => p.text).join("\n").trim();
    const fallback = combined || "No extractable text was found in this document.";
    chunkPayloads = [
      {
        content: fallback,
        pageStart: pages[0]?.pageNumber ?? 1,
        pageEnd: pages[pages.length - 1]?.pageNumber ?? 1,
        chunkIndex: 0,
      },
    ];
  }

  const embeddings = await embedTexts(chunkPayloads.map((c) => c.content));

  const fullText = pages.map((p) => `Page ${p.pageNumber}\n${p.text}`).join("\n\n");
  const cleanedMetadata = { ...(doc.metadata ?? {}) };
  // Remove any stale error messages from previous failed attempts.
  delete (cleanedMetadata as Record<string, unknown>)["error"];

  await db.transaction(async (tx) => {
    await tx.delete(chunks).where(eq(chunks.documentId, doc.id));

    const rows = chunkPayloads.map((chunk, idx) => ({
      documentId: doc.id,
      content: chunk.content,
      embedding: embeddings[idx],
      chunkIndex: idx,
      metadata: {
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        source: doc.filePath,
      },
    }));

    if (rows.length > 0) {
      await tx.insert(chunks).values(rows);
    }

    const [session] = await tx
      .select()
      .from(sessions)
      .where(eq(sessions.id, doc.sessionId));

    const previousActive = session?.activeDocumentId;

    await tx
      .update(documents)
      .set({
        status: "ready",
        content: fullText,
        metadata: cleanedMetadata,
        embedding: null,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));

    await tx
      .update(sessions)
      .set({ activeDocumentId: doc.id, updatedAt: new Date() })
      .where(eq(sessions.id, doc.sessionId));

    if (previousActive && previousActive !== doc.id) {
      await tx.delete(chunks).where(eq(chunks.documentId, previousActive));
      await tx.delete(documents).where(eq(documents.id, previousActive));
    }
  });

  return { docId: doc.id, chunks: chunkPayloads.length };
}
