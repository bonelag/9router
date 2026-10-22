import { NextResponse } from "next/server";
import { getDeletedModels, deleteOfficialModels, restoreOfficialModels } from "@/lib/deletedModelsDb";

export const dynamic = "force-dynamic";

// GET /api/models/deleted?providerAlias=xxx
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const providerAlias = searchParams.get("providerAlias");
    const all = await getDeletedModels();
    if (providerAlias) return NextResponse.json({ ids: all[providerAlias] || [] });
    return NextResponse.json({ deleted: all });
  } catch (error) {
    console.log("Error fetching deleted models:", error);
    return NextResponse.json({ error: "Failed to fetch deleted models" }, { status: 500 });
  }
}

// POST /api/models/deleted  body: { providerAlias, ids: [...] }
export async function POST(request) {
  try {
    const { providerAlias, ids } = await request.json();
    if (!providerAlias || !Array.isArray(ids)) {
      return NextResponse.json({ error: "providerAlias and ids[] required" }, { status: 400 });
    }
    await deleteOfficialModels(providerAlias, ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting official models:", error);
    return NextResponse.json({ error: "Failed to delete official models" }, { status: 500 });
  }
}

// DELETE /api/models/deleted?providerAlias=xxx[&id=yyy] or body { providerAlias, ids }
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    let providerAlias = searchParams.get("providerAlias");
    let ids = [];
    const id = searchParams.get("id");
    if (id) {
      ids = id.split(",").map((s) => s.trim()).filter(Boolean);
    }
    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        const body = await request.json();
        if (body?.providerAlias) providerAlias = body.providerAlias;
        if (Array.isArray(body?.ids)) ids = body.ids;
      } catch {}
    }
    if (!providerAlias) {
      return NextResponse.json({ error: "providerAlias required" }, { status: 400 });
    }
    await restoreOfficialModels(providerAlias, ids);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error restoring official models:", error);
    return NextResponse.json({ error: "Failed to restore official models" }, { status: 500 });
  }
}
