import { NextResponse } from "next/server";
import {
  getModelOverrides,
  getOverridesByProvider,
  setModelOverride,
  deleteModelOverride,
} from "@/lib/modelOverridesDb";

export const dynamic = "force-dynamic";

const EFFORT_PATTERN = /^(none|auto|minimal|low|medium|high|xhigh|max|ultra|\d+)$/;

function validatePatch(body) {
  const patch = {};
  if (Object.hasOwn(body, "contextWindow")) {
    if (body.contextWindow === null || body.contextWindow === "") {
      patch.contextWindow = null;
    } else {
      const n = Number(body.contextWindow);
      if (!Number.isFinite(n) || n <= 0) {
        return { error: "contextWindow must be a positive number" };
      }
      patch.contextWindow = Math.floor(n);
    }
  }
  if (Object.hasOwn(body, "effort")) {
    if (body.effort === null || body.effort === "") {
      patch.effort = null;
    } else {
      const effort = String(body.effort).trim().toLowerCase();
      if (!EFFORT_PATTERN.test(effort)) {
        return { error: "Invalid effort value" };
      }
      patch.effort = effort;
    }
  }
  if (Object.hasOwn(body, "accountIds")) {
    if (body.accountIds === null) {
      patch.accountIds = null;
    } else if (!Array.isArray(body.accountIds)) {
      return { error: "accountIds must be an array" };
    } else {
      patch.accountIds = body.accountIds
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean);
    }
  }
  return { patch };
}

// GET /api/models/overrides?providerId=xxx
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    if (providerId) {
      const overrides = await getOverridesByProvider(providerId);
      return NextResponse.json({ overrides });
    }
    return NextResponse.json({ overrides: await getModelOverrides() });
  } catch (error) {
    console.log("Error fetching model overrides:", error);
    return NextResponse.json({ error: "Failed to fetch model overrides" }, { status: 500 });
  }
}

// POST /api/models/overrides
// body: { providerId, modelId, contextWindow?, effort?, accountIds? }
// A null/empty field clears that override. Sending all fields clears the entry.
export async function POST(request) {
  try {
    const body = await request.json();
    const { providerId, modelId } = body || {};
    if (!providerId || !modelId) {
      return NextResponse.json({ error: "providerId and modelId required" }, { status: 400 });
    }
    const { error, patch } = validatePatch(body);
    if (error) return NextResponse.json({ error }, { status: 400 });

    const override = await setModelOverride(providerId, modelId, patch);
    return NextResponse.json({ success: true, override });
  } catch (error) {
    console.log("Error saving model override:", error);
    return NextResponse.json({ error: "Failed to save model override" }, { status: 500 });
  }
}

// DELETE /api/models/overrides?providerId=xxx&modelId=yyy
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    let providerId = searchParams.get("providerId");
    let modelId = searchParams.get("modelId");

    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = await request.json();
        if (body?.providerId) providerId = body.providerId;
        if (body?.modelId) modelId = body.modelId;
      } catch {}
    }

    if (!providerId || !modelId) {
      return NextResponse.json({ error: "providerId and modelId required" }, { status: 400 });
    }

    await deleteModelOverride(providerId, modelId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting model override:", error);
    return NextResponse.json({ error: "Failed to delete model override" }, { status: 500 });
  }
}
