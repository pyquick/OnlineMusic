import fs from "node:fs";
import path from "node:path";
export const ASSET_STATUSES = ["draft","processing","ready","failed","archived"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
export const MEDIA_KINDS = ["audio","video","image","project"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const ACCEPTED_FORMATS: Record<MediaKind, readonly string[]> = { audio:["wav","mp3","flac","aiff","m4a","ogg"], video:["mp4","mov","webm"], image:["png","jpg","jpeg","webp"], project:["json"] };
export const MAX_ASSETS=10000, MAX_NAME_LENGTH=200, MAX_DESCRIPTION_LENGTH=2000, MAX_TAGS=50, MAX_TAG_LENGTH=50, MAX_LYRICS_LENGTH=200000;
export interface AssetMetadata { title?:string; artist?:string; album?:string; genre?:string; description?:string; tags?:string[]; durationMs?:number; sizeBytes?:number; mimeType?:string; lyrics?:string; [key:string]:unknown }
export interface Asset { id:string; ownerEmail:string; name:string; mediaKind:MediaKind; format:string; status:AssetStatus; metadata:AssetMetadata; filePath:string; hash?:string; createdAt:string; updatedAt:string }
export interface CreateAssetInput { name:string; ownerEmail?:string; mediaKind?:MediaKind; format:string; status?:AssetStatus; metadata?:AssetMetadata; filePath?:string; hash?:string }
export type UpdateAssetInput = Partial<Omit<CreateAssetInput,"name"|"ownerEmail"|"filePath">> & {name?:string};
type Store={assets:Asset[]};
const dir=process.env.AUTH_DATA_DIR?.trim()||path.join(process.cwd(),"data"), file=path.join(dir,"assets.json");
// The store holds embedded cover images, so it can be large: keep the parsed copy until the file's
// mtime changes instead of re-reading and re-parsing it for every index, cover and media request.
let cached:{mtimeMs:number;store:Store}|null=null;
function load():Store{try{const stat=fs.statSync(file);if(cached&&cached.mtimeMs===stat.mtimeMs)return cached.store;const store=JSON.parse(fs.readFileSync(file,"utf8")) as Store;cached={mtimeMs:stat.mtimeMs,store};return store}catch{return {assets:[]}}}
function save(s:Store){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,JSON.stringify(s,null,2));try{cached={mtimeMs:fs.statSync(file).mtimeMs,store:s}}catch{cached=null}}
export function listAssets(ownerEmail?:string){return load().assets.filter(a=>!ownerEmail||a.ownerEmail===ownerEmail).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
/** One lightweight list entry per asset: name, size, kind and tags — never the file bytes, path or embedded cover. */
export function assetIndexEntry(a:Asset){const m=a.metadata??{};return {id:a.id,name:a.name,mediaKind:a.mediaKind,format:a.format,status:a.status,createdAt:a.createdAt,updatedAt:a.updatedAt,
  title:m.title,artist:m.artist,album:m.album,genre:m.genre,trackNo:m.trackNo,durationMs:m.durationMs,lyrics:m.lyrics,
  sizeBytes:typeof m.sizeBytes==="number"?m.sizeBytes:0,mimeType:m.mimeType,
  fileUrl:`/api/assets/${a.id}/file`,coverUrl:m.coverData?`/api/assets/${a.id}/cover`:undefined,hasCover:Boolean(m.coverData)}}
export function getAsset(id:string,ownerEmail?:string){return load().assets.find(a=>a.id===id&&(!ownerEmail||a.ownerEmail===ownerEmail))}
export function createAsset(input:CreateAssetInput){const s=load(), now=new Date().toISOString(), a:Asset={id:crypto.randomUUID(),...input,ownerEmail:input.ownerEmail ?? "",filePath:input.filePath ?? "",mediaKind:input.mediaKind??"audio",status:input.status??"draft",metadata:input.metadata??{},createdAt:now,updatedAt:now};s.assets.push(a);save(s);return a}
export function updateAsset(id:string,input:UpdateAssetInput,ownerEmail?:string){const s=load(), i=s.assets.findIndex(a=>a.id===id&&(!ownerEmail||a.ownerEmail===ownerEmail));if(i<0)return;const a={...s.assets[i],...input,metadata:input.metadata?{...s.assets[i].metadata,...input.metadata}:s.assets[i].metadata,updatedAt:new Date().toISOString()};s.assets[i]=a;save(s);return a}
