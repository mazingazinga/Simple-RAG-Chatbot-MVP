import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { documents } from "@/db/schema";
import { processDocument } from "./process-document";

async function nextDocumentId(target?: number) {
  if (target) return target;
  const doc = await db.query.documents.findFirst({
    where: eq(documents.status, "processing"),
    orderBy: (docs, { asc }) => asc(docs.createdAt),
  });
  return doc?.id;
}

async function main() {
  console.log("Worker booting...");

  const targetId =
    Number(process.env.DOC_ID) || Number(process.argv[2]) || undefined;
  const docId = await nextDocumentId(targetId);
  if (!docId) {
    console.log("No documents pending processing. Exiting.");
    return;
  }

  const result = await processDocument(docId);
  console.log("Processed document", result);
}

main()
  .catch((error) => {
    console.error("[worker] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
