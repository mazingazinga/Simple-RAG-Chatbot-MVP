import { NextResponse } from "next/server";

import { createSession } from "@/db/queries";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { title = "Chat Session" } = body ?? {};

    const session = await createSession({ title });
    return NextResponse.json({ session });
  } catch (error) {
    console.error("[session/create] error", error);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
