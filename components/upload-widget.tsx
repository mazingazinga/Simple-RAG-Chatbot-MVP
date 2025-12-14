"use client";

import { useRef, useState } from "react";

import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

type UploadState =
  | { status: "idle"; progress: 0; message: string | null }
  | { status: "uploading" | "processing"; progress: number; message: string | null }
  | { status: "done"; progress: number; message: string | null }
  | { status: "error"; progress: number; message: string };

const MAX_CHUNK_SIZE = 512 * 1024; // 512kb
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

type UploadWidgetProps = {
  sessionId?: number;
  onComplete?: () => void;
  disableWhileProcessing?: boolean;
};

export function UploadWidget({
  sessionId,
  onComplete,
  disableWhileProcessing = false,
}: UploadWidgetProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<UploadState>({
    status: "idle",
    progress: 0,
    message: null,
  });

  const disabled = disableWhileProcessing || state.status === "uploading";

  async function handleFile(file: File) {
    setState({ status: "uploading", progress: 0, message: "Starting upload..." });

    if (file.size > MAX_UPLOAD_BYTES) {
      setState({
        status: "error",
        progress: 0,
        message: "max upload size exceeded",
      });
      return;
    }

    try {
      const initRes = await fetch("/api/upload/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: file.name,
          filename: file.name,
          sizeBytes: file.size,
          sessionId,
        }),
      });

      if (!initRes.ok) {
        const errJson = await initRes.json().catch(() => ({} as { error?: string }));
        const message = errJson?.error ?? "Failed to start upload";
        throw new Error(message);
      }

      const initData = await initRes.json();
      const token = initData.token as string;

      let uploaded = 0;
      const reader = file.stream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;

        let offset = 0;
        while (offset < value.length) {
          const chunk = value.slice(offset, offset + MAX_CHUNK_SIZE);
          offset += chunk.length;

          const chunkRes = await fetch(
            `/api/upload/chunk?token=${encodeURIComponent(token)}`,
            {
              method: "POST",
              body: chunk,
            },
          );

          if (!chunkRes.ok) {
            throw new Error("Chunk upload failed");
          }

          uploaded += chunk.length;
          const progress = Math.min(
            100,
            Math.round((uploaded / Math.max(1, file.size)) * 100),
          );
          setState({
            status: "uploading",
            progress,
            message: `Uploaded ${formatBytes(uploaded)} of ${formatBytes(file.size)}`,
          });
        }
      }

      setState({ status: "processing", progress: 100, message: "Finalizing..." });

      const completeRes = await fetch(
        `/api/upload/complete?token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
        },
      );

      if (!completeRes.ok) {
        const errText = await completeRes.text().catch(() => "");
        let message = "Failed to finalize upload";
        try {
          const json = JSON.parse(errText);
          message = json.error ?? message;
        } catch {
          if (errText) message = errText;
        }
        throw new Error(message);
      }

      setState({
        status: "done",
        progress: 100,
        message: "Upload complete",
      });
      onComplete?.();
    } catch (error) {
      setState({
        status: "error",
        progress: 0,
        message: error instanceof Error ? error.message : "Upload failed",
      });
      // Allow re-selecting the same file after an error.
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">Chunked upload demo</p>
        <p className="text-sm text-muted-foreground">
          Streams a file with fetch and appends chunks server-side (max 50 MB per file).
        </p>
      </div>

      <div className="flex w-full items-center justify-between rounded-lg border border-dashed border-border px-4 py-3 text-sm font-medium text-foreground">
        <span>Select a file to upload</span>
        <div className="space-x-2">
          <input
            ref={inputRef}
            id="upload-input"
            type="file"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                if (!disabled) void handleFile(file);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Browse
          </Button>
        </div>
      </div>

      <Progress value={state.progress} />

      <div className="text-sm text-muted-foreground">
        {state.message ?? "Waiting for upload..."}
      </div>
    </div>
  );
}

function formatBytes(size: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = units.shift()!;
  while (value > 1000 && units.length) {
    value /= 1024;
    unit = units.shift()!;
  }
  return `${value.toFixed(value >= 10 || unit === "B" ? 0 : 1)} ${unit}`;
}



