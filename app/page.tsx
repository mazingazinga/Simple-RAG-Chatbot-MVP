import ChatLanding from "@/components/chat/chat-landing";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <div className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.15),transparent_35%),radial-gradient(circle_at_80%_0%,rgba(14,165,233,0.18),transparent_30%),radial-gradient(circle_at_50%_80%,rgba(45,212,191,0.2),transparent_30%)]" />
        <div className="relative mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-20 pt-12 lg:px-10">
          <header className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/20">
              PDF Q&A | RAG
            </span>
            <h1 className="text-4xl font-semibold leading-tight tracking-tight text-slate-900 md:text-5xl">
              Upload a PDF, process with RAG, and chat instantly.
            </h1>
            <p className="max-w-3xl text-lg text-muted-foreground">
              Background worker extracts text-only content, chunks and embeds it, then streams
              grounded answers with inline citations. Your session persists locally.
            </p>
          </header>

          <section className="rounded-3xl border border-white/40 bg-white/80 p-6 shadow-2xl shadow-indigo-100 backdrop-blur">
            <ChatLanding />
          </section>
        </div>
      </div>
    </main>
  );
}
