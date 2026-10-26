import { NextResponse } from "next/server";
import { resetOpencodeSession } from "open-sse/executors/opencode.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const cleanId = String(id || "").toLowerCase().trim();
    if (cleanId !== "opencode" && cleanId !== "oc" && cleanId !== "opencode-free") {
      return NextResponse.json(
        { error: "Reset session is only supported for OpenCode Free" },
        { status: 400 }
      );
    }

    const sessionId = resetOpencodeSession();
    return NextResponse.json({ success: true, sessionId });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to reset session" },
      { status: 500 }
    );
  }
}
