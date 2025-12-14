import { notFound } from "next/navigation";

import ChatClient from "@/components/chat/chat-client";

type Params = {
  sessionId: string;
};

export default function ChatPage({ params }: { params: Params }) {
  const sessionId = Number(params.sessionId);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    notFound();
  }

  return <ChatClient sessionId={sessionId} />;
}
