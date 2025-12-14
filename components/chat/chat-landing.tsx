"use client";

import { useEffect, useState } from "react";

import ChatClient from "@/components/chat/chat-client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export default function ChatLanding() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initSession();
  }, []);

  async function initSession(forceReset = false) {
    setLoading(true);
    setError(null);
    try {
      const storedRaw = localStorage.getItem("rag-session-id");
      const stored = storedRaw ? Number(storedRaw) : null;

      if (stored && Number.isFinite(stored)) {
        if (forceReset) {
          const reset = await fetch(`/api/session/${stored}/reset`, { method: "POST" });
          if (reset.ok) {
            setSessionId(stored);
            return;
          }
          console.warn("session reset failed, creating new session instead");
        } else {
          const res = await fetch(`/api/session/${stored}`);
          if (res.ok) {
            setSessionId(stored);
            return;
          }
        }
      }

      const created = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!created.ok) throw new Error("Failed to create session");
      const data = await created.json();
      const id = Number(data.session?.id);
      if (!id) throw new Error("Invalid session id");
      localStorage.setItem("rag-session-id", String(id));
      setSessionId(id);
    } catch (error) {
      console.error("session init failed", error);
      setError(
        error instanceof Error ? error.message : "Could not create a new session. Try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4">
        <div className="h-14 w-14 animate-spin rounded-full border-4 border-primary/40 border-t-primary" />
        <div className="w-48">
          <Progress value={65} />
        </div>
        <p className="text-sm text-muted-foreground">Preparing your chat workspace...</p>
      </div>
    );
  }

  if (!sessionId || error) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-white/80 p-6 text-center">
        <p className="text-base font-semibold text-foreground">
          {error ?? "No session available"}
        </p>
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t start a new chat session. Please try again.
        </p>
        <div className="flex gap-2">
          <Button onClick={() => void initSession(false)} variant="secondary">
            Retry with last session
          </Button>
          <Button onClick={() => void initSession(true)}>Reset session</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Upload a PDF and ask questions instantly. Reset clears chat + docs for this session.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void initSession(true)}>
          Reset session
        </Button>
      </div>
      <ChatClient sessionId={sessionId} />
    </div>
  );
}
