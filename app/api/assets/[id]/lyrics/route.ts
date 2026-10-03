import { NextResponse } from "next/server";
import { getAsset, updateAsset } from "@/lib/assets";
import { session } from "@/lib/accounts";
import { applyCors, denyCrossSite, optionsResponse } from "@/lib/cors";
import { parseLyricsJson } from "@/shared/lyrics/parse";
import { toJson } from "@/shared/lyrics/serialize";
import { LyricsValidationError, validateLyricsDoc } from "@/shared/lyrics/validation";

/**
 * The structured lyrics document of one asset: the editor's save path and every client's read
 * path. It is its own route because the document is the one metadata field too large and too
 * shaped to ride the index stream or the generic PATCH validation.
 */
export const dynamic = "force-dynamic";
type Context = { params: { id: string } };

function user(request: Request) {
  return session(request.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1]);
}

export const OPTIONS = (request: Request) => optionsResponse(request);

export function GET(request: Request, { params }: Context) {
  const account = user(request);
  const asset = account && getAsset(params.id, account.email);
  if (!asset) return applyCors(request, NextResponse.json({ error: "asset not found" }, { status: 404 }));
  const stored = typeof asset.metadata.lyricsDoc === "string" ? asset.metadata.lyricsDoc : "";
  return applyCors(request, NextResponse.json({ doc: stored ? parseLyricsJson(stored) : null }));
}

export async function PUT(request: Request, { params }: Context) {
  if (denyCrossSite(request)) return applyCors(request, NextResponse.json({ error: "This server does not accept requests from that origin" }, { status: 403 }));
  const account = user(request);
  if (!account || !getAsset(params.id, account.email)) {
    return applyCors(request, NextResponse.json({ error: "asset not found" }, { status: 404 }));
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return applyCors(request, NextResponse.json({ error: "request body must be JSON" }, { status: 400 }));
  }
  try {
    const doc = validateLyricsDoc(body);
    updateAsset(params.id, { metadata: { lyricsDoc: toJson(doc) } }, account.email);
    return applyCors(request, NextResponse.json({ doc }));
  } catch (error) {
    if (error instanceof LyricsValidationError) return applyCors(request, NextResponse.json({ error: error.message }, { status: 400 }));
    return applyCors(request, NextResponse.json({ error: "unable to save lyrics" }, { status: 500 }));
  }
}
