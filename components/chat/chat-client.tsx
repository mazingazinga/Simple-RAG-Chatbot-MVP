"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UploadWidget } from "@/components/upload-widget";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type SessionState = {
  session: {
    id: number;
    title: string;
    activeDocumentId: number | null;
  };
  activeDocument: {
    id: number;
    title: string;
    status: string;
    uploadCompletedAt: string | null;
    sizeBytes: number | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  messages: Array<{
    id: number;
    role: "user" | "assistant" | "system";
    content: string;
    metadata?: Record<string, unknown> | null;
  }>;
};

type StreamCitation = {
  id: number;
  content: string;
  score: number;
  pageStart?: number;
  pageEnd?: number;
  metadata?: Record<string, unknown>;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: StreamCitation[];
  pending?: boolean;
};

type Props = {
  sessionId: number;
};

export default function ChatClient({ sessionId }: Props) {
  const [loading, setLoading] = useState(true);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastMessageCountRef = useRef(0);

  const docStatus = sessionState?.activeDocument?.status ?? "pending";
  const hasDoc = Boolean(sessionState?.activeDocument);
  const isReady = docStatus === "ready";
  const processing = useMemo(
    () => docStatus === "processing" || docStatus === "uploading",
    [docStatus],
  );
  const latestCitations = useMemo(() => {
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    return last?.citations ?? [];
  }, [messages]);

  const refreshSession = useCallback(async () => {
    setLoading((prev) => prev && !sessionState);
    const res = await fetch(`/api/session/${sessionId}`);
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = (await res.json()) as SessionState;
    setSessionState(data);
    setLoading(false);
  }, [sessionId, sessionState]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!processing) return;
    const id = setInterval(() => {
      void refreshSession();
    }, 3000);
    return () => clearInterval(id);
  }, [processing, refreshSession]);

  useEffect(() => {
    if (sessionState) {
      const hydrated = sessionState.messages.map((m) => ({
        id: `persisted-${m.id}`,
        role: m.role,
        content: m.content,
        citations: (m.metadata as Record<string, unknown> | null | undefined)?.[
          "citations"
        ] as StreamCitation[] | undefined,
      })) as ChatMessage[];
      setMessages(hydrated);
      setLoading(false);
    }
  }, [sessionState]);

  useEffect(() => {
    const count = messages.length;
    if (count > lastMessageCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    lastMessageCountRef.current = count;
  }, [messages.length]);

  async function streamChat() {
    if (!question.trim()) return;
    setStreaming(true);
    let succeeded = false;
    let failedMessage = "Sorry, I could not complete that request.";

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}-user`,
      role: "user",
      content: question.trim(),
    };

    const assistantMessage: ChatMessage = {
      id: `local-${Date.now()}-assistant`,
      role: "assistant",
      content: "",
      citations: [],
      pending: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setQuestion("");

    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, question: userMessage.content }),
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text().catch(() => "");
        try {
          const json = JSON.parse(errorText);
          failedMessage = json.error ?? failedMessage;
        } catch {
          failedMessage = errorText || failedMessage;
        }
        throw new Error(failedMessage);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pendingCitations: StreamCitation[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.replace("data:", "").trim();
          if (!payload) continue;
          if (payload === "[DONE]") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, pending: false, citations: pendingCitations }
                  : m,
              ),
            );
            break;
          }

          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === "start") continue;
            if (parsed.type === "citations") {
              pendingCitations = parsed.citations ?? [];
              continue;
            }
            if (parsed.type === "error") {
              failedMessage =
                typeof parsed.error === "string"
                  ? parsed.error
                  : failedMessage;
              throw new Error(failedMessage);
            }
          } catch {
            // not JSON; treat as token text
          }

          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, content: m.content + payload }
                : m,
            ),
          );
        }

        succeeded = true;
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMessage.id
            ? { ...m, content: failedMessage, pending: false }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
      if (succeeded) {
        void refreshSession();
      }
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 gap-6 bg-gradient-to-b from-slate-50 via-white to-white px-4 py-8 lg:grid-cols-[360px,1fr] lg:px-10">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Document</CardTitle>
            <CardDescription>Upload and monitor processing.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UploadWidget
              sessionId={sessionId}
              onComplete={() => void refreshSession()}
            />
            <ActiveDocumentStatus doc={sessionState?.activeDocument} />
          </CardContent>
        </Card>
      </div>

      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle>Chat</CardTitle>
          <CardDescription>
            Ask questions about the active document. Chat is disabled while processing.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4">
          <ScrollArea className="h-[60vh] w-full rounded-lg border border-border bg-white p-4">
            <div className="space-y-4">
              {messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}
              {streaming ? (
                <p className="text-xs text-muted-foreground px-1">Thinking...</p>
              ) : null}
              {messages.length === 0 && !loading ? (
                <p className="text-sm text-muted-foreground">
                  Start by uploading a document and asking a question.
                </p>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>

          <RelatedCitations citations={latestCitations} />

          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void streamChat();
            }}
          >
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                processing
                  ? "Document is processing. Please wait..."
                  : hasDoc
                    ? "Ask something about your document"
                    : "Upload a document to start chatting"
              }
            disabled={streaming || processing || !isReady}
          />
          <Button type="submit" disabled={streaming || processing || !isReady}>
            {streaming ? "Thinking..." : "Send"}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isAssistant = message.role === "assistant";

  return (
    <div
      className={cn("flex w-full gap-2", isAssistant ? "justify-start" : "justify-end")}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-lg border border-border px-3 py-2 text-sm shadow-sm",
          isAssistant ? "bg-muted text-foreground" : "bg-primary text-primary-foreground",
        )}
      >
        <p className="whitespace-pre-wrap leading-relaxed">{message.content || ""}</p>
        {isAssistant ? (
          <Citations citations={message.citations ?? []} />
        ) : null}
      </div>
    </div>
  );
}

function ActiveDocumentStatus({
  doc,
}: {
  doc: SessionState["activeDocument"] | null | undefined;
}) {
  if (!doc) {
    return (
      <p className="text-xs text-muted-foreground">
        No document uploaded yet. Your last chat messages remain until you reset the session.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-foreground">{doc.title}</span>
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {doc.status === "processing"
            ? "processing in background"
            : doc.status === "uploading"
              ? "uploading"
              : doc.status === "failed"
                ? "processing failed"
                : doc.status}
        </span>
      </div>
      {doc.sizeBytes ? (
        <p className="text-xs text-muted-foreground">Size: {doc.sizeBytes} bytes</p>
      ) : null}
      {doc.status === "processing" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Processing in the background. This card will update when ready.
        </p>
      ) : null}
      {doc.status === "ready" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Ready for chat with grounded answers and citations.
        </p>
      ) : null}
      {doc.status === "failed" ? (
        <p className="mt-2 text-xs text-destructive">
          Document processing failed. Please re-upload and try again.
        </p>
      ) : null}
    </div>
  );
}

function Citations({ citations }: { citations: StreamCitation[] }) {
  if (!citations || citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs font-semibold text-foreground">Citations</p>
      <ul className="space-y-1">
        {citations.map((citation, idx) => (
          <li key={citation.id} className="rounded-md bg-white/70 p-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">[{idx + 1}]</span>{" "}
            {citation.content.slice(0, 240)}
            {citation.content.length > 240 ? "..." : ""}
            <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-foreground/70">
              <span>score {citation.score.toFixed(3)}</span>
              {citation.pageStart ? (
                <span>
                  pages {citation.pageStart}
                  {citation.pageEnd && citation.pageEnd !== citation.pageStart
                    ? `-${citation.pageEnd}`
                    : ""}
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelatedCitations({ citations }: { citations: StreamCitation[] }) {
  if (!citations || citations.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-muted/50 p-3">
      <p className="text-xs font-semibold text-foreground">Related snippets</p>
      <div className="mt-2 grid gap-2 md:grid-cols-2">
        {citations.map((c, idx) => (
          <div key={`${c.id}-${idx}`} className="rounded-md border border-border bg-white p-3">
            <div className="mb-1 text-[11px] font-semibold text-primary">[{idx + 1}]</div>
            <p className="text-xs text-muted-foreground">
              {c.content.slice(0, 220)}
              {c.content.length > 220 ? "..." : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-foreground/70">
              <span>score {c.score.toFixed(3)}</span>
              {c.pageStart ? (
                <span>
                  pages {c.pageStart}
                  {c.pageEnd && c.pageEnd !== c.pageStart ? `-${c.pageEnd}` : ""}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
