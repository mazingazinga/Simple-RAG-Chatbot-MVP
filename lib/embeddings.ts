import OpenAI from "openai";

import { DEFAULT_EMBEDDING_DIM } from "@/db/schema";

const MODEL = "text-embedding-3-large";

function hashEmbedding(text: string) {
  const vector = new Array<number>(DEFAULT_EMBEDDING_DIM).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  for (let i = 0; i < DEFAULT_EMBEDDING_DIM; i++) {
    const val = ((hash + i * 97) % 1000) / 1000;
    vector[i] = val;
  }
  return vector;
}

async function embedWithOpenAI(texts: string[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.embeddings.create({
      model: MODEL,
      input: texts,
      dimensions: DEFAULT_EMBEDDING_DIM,
    });
    return response.data.map((d) => d.embedding);
  } catch (error) {
    console.error("[embeddings] falling back to hash embedding", error);
    return null;
  }
}

export async function embedTexts(texts: string[]) {
  if (texts.length === 0) return [];
  const embedded = await embedWithOpenAI(texts);
  if (embedded && embedded.length === texts.length) return embedded;
  return texts.map((text) => hashEmbedding(text));
}

export async function embedText(text: string) {
  const [vector] = await embedTexts([text]);
  return vector;
}
