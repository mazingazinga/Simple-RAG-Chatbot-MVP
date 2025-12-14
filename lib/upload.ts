import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

export type UploadTokenPayload = {
  docId: number;
  sessionId: number;
  nonce: string;
  exp: number;
};

const UPLOAD_DIR = path.join(process.cwd(), "tmp", "uploads");
const FINAL_DIR = path.join(process.cwd(), "tmp", "files");

const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

function getSecret() {
  return process.env.UPLOAD_SECRET ?? "dev-upload-secret";
}

export async function ensureUploadDirs() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await fs.mkdir(FINAL_DIR, { recursive: true });
}

export function makeUploadToken(docId: number, sessionId: number) {
  const payload: UploadTokenPayload = {
    docId,
    sessionId,
    nonce: crypto.randomBytes(12).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };

  const secret = getSecret();
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("hex");

  return `${encoded}.${signature}`;
}

export function verifyUploadToken(token: string): UploadTokenPayload {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) {
    throw new Error("Malformed token");
  }

  const secret = getSecret();
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid token signature");
  }

  const payload: UploadTokenPayload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return payload;
}

export function getTempFilePath(payload: UploadTokenPayload) {
  return path.join(UPLOAD_DIR, `${payload.docId}-${payload.nonce}.part`);
}

export function getFinalFilePath(payload: UploadTokenPayload, filename?: string) {
  const safeName =
    filename?.replace(/[^a-zA-Z0-9._-]/g, "_") || `doc-${payload.docId}.bin`;
  return path.join(FINAL_DIR, `doc-${payload.docId}-${safeName}`);
}
