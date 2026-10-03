import { NextResponse } from "next/server";
import fs from "node:fs/promises"; import path from "node:path"; import crypto from "node:crypto";
import { assetIndexEntry, createAsset, listAssets, MAX_ASSETS } from "@/lib/assets"; import { session } from "@/lib/accounts";
import { AssetValidationError, validateCreateInput } from "@/lib/asset-validation";
import { applyCors, denyCrossSite, optionsResponse } from "@/lib/cors";
export const dynamic="force-dynamic";
function user(request:Request){return session(request.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1])}

export const OPTIONS = (request: Request) => optionsResponse(request);

export async function GET(request:Request){
  const u=user(request);if(!u)return applyCors(request,NextResponse.json({error:"Sign in to see your projects"},{status:401}));
  const entries=listAssets(u.email).map(assetIndexEntry);
  const streamed=new URL(request.url).searchParams.get("index")==="1";
  if(!streamed)return applyCors(request,NextResponse.json({assets:entries}));
  // Newline-delimited JSON: the client renders each item the moment its line arrives, so a large
  // library paints its first rows without waiting for the whole index (covers are fetched separately).
  const encoder=new TextEncoder();let cursor=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){
    if(cursor>=entries.length){controller.close();return}
    const batch=entries.slice(cursor,cursor+8);cursor+=batch.length;
    controller.enqueue(encoder.encode(batch.map((entry)=>`${JSON.stringify(entry)}\n`).join("")));
  }});
  return applyCors(request,new Response(body,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"}}));
}
/**
 * An upload: the file itself, its kind, and the tags read out of it on the client.
 *
 * Everything about the record goes through the same validator `PATCH` uses, and *before* the bytes
 * are written — an upload that would produce an invalid asset is refused while it is still just a
 * request, not after it has left a file behind. That was the gap: this route used to `JSON.parse`
 * the metadata straight into the store, so a name of any length, an unknown `mediaKind` and a
 * hundred tags all landed happily (measured: three such uploads answered 201 before this change
 * and 400 after), and the `AssetValidationError` in the catch below could never fire.
 */
export async function POST(request:Request){
  if(denyCrossSite(request))return applyCors(request,NextResponse.json({error:"This server does not accept requests from that origin"},{status:403}));
  const u=user(request); if(!u)return applyCors(request,NextResponse.json({error:"Sign in first"},{status:401}));
  try{
    if(listAssets(u.email).length>=MAX_ASSETS)return applyCors(request,NextResponse.json({error:"asset limit reached"},{status:507}));
    const form=await request.formData(), file=form.get("file");
    if(!(file instanceof File))return applyCors(request,NextResponse.json({error:"file required"},{status:400}));
    const metadata=JSON.parse(String(form.get("metadata")||"{}")) as Record<string,unknown>;
    // Size and MIME come from the upload itself, never from what the client claims in the form.
    const input=validateCreateInput({
      name:file.name,
      mediaKind:String(form.get("mediaKind")||"audio"),
      format:path.extname(file.name).slice(1).toLowerCase(),
      metadata:{...metadata,sizeBytes:file.size,mimeType:file.type},
    });
    const data=Buffer.from(await file.arrayBuffer());
    const dir=process.env.AUTH_DATA_DIR||path.join(process.cwd(),"data"), files=path.join(dir,"media");
    await fs.mkdir(files,{recursive:true});
    const stored=path.join(files,crypto.randomUUID()+path.extname(file.name));
    await fs.writeFile(stored,data);
    const asset=createAsset({...input,ownerEmail:u.email,filePath:stored,hash:crypto.createHash("sha256").update(data).digest("hex")});
    return applyCors(request,NextResponse.json({asset:assetIndexEntry(asset)},{status:201}));
  }catch(e){
    if(e instanceof AssetValidationError)return applyCors(request,NextResponse.json({error:e.message},{status:400}));
    return applyCors(request,NextResponse.json({error:"unable to upload asset"},{status:500}));
  }
}
