import { NextResponse } from "next/server";
import fs from "node:fs/promises"; import path from "node:path"; import crypto from "node:crypto";
import { assetIndexEntry, createAsset, listAssets, MAX_ASSETS } from "@/lib/assets"; import { session } from "@/lib/accounts";
import { AssetValidationError, validateCreateInput } from "@/lib/asset-validation";
export const dynamic="force-dynamic";
function user(request:Request){return session(request.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1])}


export async function GET(request:Request){
  const u=user(request);if(!u)return NextResponse.json({error:"Sign in to see your projects"},{status:401});
  const entries=listAssets(u.email).map(assetIndexEntry);
  const streamed=new URL(request.url).searchParams.get("index")==="1";
  if(!streamed)return NextResponse.json({assets:entries});
  // Newline-delimited JSON: the client renders each item the moment its line arrives, so a large
  // library paints its first rows without waiting for the whole index (covers are fetched separately).
  const encoder=new TextEncoder();let cursor=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){
    if(cursor>=entries.length){controller.close();return}
    const batch=entries.slice(cursor,cursor+8);cursor+=batch.length;
    controller.enqueue(encoder.encode(batch.map((entry)=>`${JSON.stringify(entry)}\n`).join("")));
  }});
  return new Response(body,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"}});
}
export async function POST(request:Request){const u=user(request);if(!u)return NextResponse.json({error:"Sign in first"},{status:401});try{if(listAssets(u.email).length>=MAX_ASSETS)return NextResponse.json({error:"asset limit reached"},{status:507});const form=await request.formData(), file=form.get("file");if(!(file instanceof File))return NextResponse.json({error:"file required"},{status:400});const data=Buffer.from(await file.arrayBuffer()), dir=process.env.AUTH_DATA_DIR||path.join(process.cwd(),"data"), files=path.join(dir,"media");await fs.mkdir(files,{recursive:true});const id=crypto.randomUUID(), stored=path.join(files,id+path.extname(file.name));await fs.writeFile(stored,data);const metadata=JSON.parse(String(form.get("metadata")||"{}"));const asset=createAsset({name:file.name,ownerEmail:u.email,mediaKind:String(form.get("mediaKind")||"audio") as any,format:path.extname(file.name).slice(1).toLowerCase(),metadata:{...metadata,sizeBytes:file.size,mimeType:file.type},filePath:stored,hash:crypto.createHash("sha256").update(data).digest("hex")});return NextResponse.json({asset:assetIndexEntry(asset)},{status:201})}catch(e){if(e instanceof AssetValidationError)return NextResponse.json({error:e.message},{status:400});return NextResponse.json({error:"unable to upload asset"},{status:500})}}
