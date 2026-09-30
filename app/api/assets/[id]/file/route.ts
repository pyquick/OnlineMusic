import { NextResponse } from "next/server"; import fs from "node:fs"; import crypto from "node:crypto"; import { getAsset } from "@/lib/assets"; import { session } from "@/lib/accounts";
export const dynamic="force-dynamic";

const CACHE_CONTROL="private, max-age=2592000, immutable";
const hashCache=new Map<string,string>();

/** SHA-256 of the stored file: taken from the asset record when uploaded, computed once per asset otherwise. */
async function fileHash(asset:{id:string;filePath:string;hash?:string}){
  if(asset.hash)return asset.hash;
  const cached=hashCache.get(asset.id); if(cached)return cached;
  const hash=await new Promise<string>((resolve,reject)=>{const h=crypto.createHash("sha256");fs.createReadStream(asset.filePath).on("data",(chunk)=>h.update(chunk)).on("end",()=>resolve(h.digest("hex"))).on("error",reject)});
  hashCache.set(asset.id,hash); return hash;
}

function matchesEtag(header:string|null,etag:string){
  if(!header)return false;
  return header.split(",").some((value)=>{const tag=value.trim().replace(/^W\//,"");return tag==="*"||tag===etag});
}

/**
 * The file as a web stream that dies with its reader. A browser abandons range requests constantly —
 * every seek on the transport, every prefetch it reconsiders — and cancelling the response has to
 * stop the file handle with it: `Readable.toWeb` keeps the reader pushing chunks at a controller the
 * cancellation already closed, which throws ERR_INVALID_STATE into the server log. Here the cancel
 * destroys the read stream, and the flag makes a chunk already in flight when that happens a no-op.
 */
function fileStream(path:string,range?:{start:number;end:number}){
  const file=fs.createReadStream(path,range);
  let open=true;
  return new ReadableStream<Uint8Array>({
    start(controller){
      // No encoding is set, so a chunk is always bytes; the cast only settles the stream's own union.
      file.on("data",(chunk)=>{if(open)controller.enqueue(chunk as Buffer)});
      file.on("end",()=>{if(open){open=false;controller.close()}});
      file.on("error",(error)=>{if(open){open=false;controller.error(error)}});
    },
    cancel(){open=false;file.destroy()},
  });
}

export async function GET(request:Request,{params}:{params:{id:string}}){
  const token=request.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1],u=session(token),a=u&&getAsset(params.id,u.email);
  if(!a)return NextResponse.json({error:"not found"},{status:404});
  try{
    const stat=fs.statSync(a.filePath), type=String(a.metadata.mimeType||"application/octet-stream");
    const etag=`"${await fileHash(a)}"`;
    const cacheHeaders={"ETag":etag,"Cache-Control":CACHE_CONTROL,"Last-Modified":stat.mtime.toUTCString(),"Accept-Ranges":"bytes","Content-Disposition":`inline; filename="${encodeURIComponent(a.name)}"`};
    if(matchesEtag(request.headers.get("if-none-match"),etag))return new NextResponse(null,{status:304,headers:cacheHeaders});
    const range=request.headers.get("range");
    if(!range)return new NextResponse(fileStream(a.filePath),{headers:{...cacheHeaders,"Content-Type":type,"Content-Length":String(stat.size)}});
    const match=/bytes=(\d*)-(\d*)/.exec(range);
    if(!match)return new NextResponse(null,{status:416});
    // Serve exactly what was asked for: an open-ended range runs to the end of the file, so the
    // browser receives one complete response it can cache in full instead of 1 MB fragments.
    const start=!match[1]&&match[2]?Math.max(0,stat.size-Number(match[2])):match[1]?Number(match[1]):0;
    const end=Math.min(!match[1]&&match[2]?stat.size-1:match[2]?Number(match[2]):stat.size-1,stat.size-1);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=stat.size||end<start)return new NextResponse(null,{status:416});
    const length=end-start+1;
    return new NextResponse(fileStream(a.filePath,{start,end}),{status:206,headers:{...cacheHeaders,"Content-Range":`bytes ${start}-${end}/${stat.size}`,"Content-Length":String(length),"Content-Type":type}});
  }catch{return NextResponse.json({error:"file not found"},{status:404})}
}
