import { NextResponse } from "next/server"; import crypto from "node:crypto";
import { getAsset } from "@/lib/assets"; import { session } from "@/lib/accounts";
import { applyCors } from "@/lib/cors";
export const dynamic="force-dynamic";

/** Decodes the stored cover data URL into bytes, so artwork is fetched per card instead of riding along with the index. */
function decodeCover(coverData:string){
  const match=/^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(coverData);
  if(!match)return null;
  const [,type,base64,payload]=match;
  try{
    const bytes=base64?Buffer.from(payload,"base64"):Buffer.from(decodeURIComponent(payload),"utf8");
    return {bytes,type:type||"image/jpeg"};
  }catch{return null}
}

export async function GET(request:Request,{params}:{params:{id:string}}){
  const token=request.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1],u=session(token),a=u&&getAsset(params.id,u.email);
  if(!a)return applyCors(request,NextResponse.json({error:"not found"},{status:404}));
  const cover=typeof a.metadata.coverData==="string"?a.metadata.coverData:"";
  const decoded=cover?decodeCover(cover):null;
  if(!decoded)return applyCors(request,NextResponse.json({error:"no cover"},{status:404}));
  const etag=`"${crypto.createHash("sha1").update(cover).digest("hex")}"`;
  const headers={"Content-Type":decoded.type,"Cache-Control":"private, max-age=604800","ETag":etag};
  if(request.headers.get("if-none-match")?.split(",").some((value)=>value.trim().replace(/^W\//,"")===etag))return applyCors(request,new NextResponse(null,{status:304,headers}));
  return applyCors(request,new NextResponse(new Uint8Array(decoded.bytes),{headers}));
}
