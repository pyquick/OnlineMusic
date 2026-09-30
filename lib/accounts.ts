import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type Account = { email: string; name: string; passwordHash: string; createdAt: string };
type Store = { accounts: Account[]; sessions: Record<string, { email: string; expiresAt: number }> };
const dataDirectory = process.env.AUTH_DATA_DIR?.trim() || path.join(process.cwd(), "data");
const file = path.join(dataDirectory, "accounts.json");
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 365;
function load(): Store { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return { accounts: [], sessions: {} }; } }
function save(store: Store) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(store, null, 2)); }
function hash(password: string, salt = crypto.randomBytes(16).toString("hex")) { return `${salt}:${crypto.scryptSync(password, salt, 32).toString("hex")}`; }
function verify(password: string, stored: string) { const [salt, digest] = stored.split(":"); return !!salt && !!digest && crypto.timingSafeEqual(Buffer.from(digest, "hex"), crypto.scryptSync(password, salt, 32)); }
export function register(email: string, password: string, name: string) { const store = load(); if (store.accounts.some((a) => a.email === email)) return null; store.accounts.push({ email, name, passwordHash: hash(password), createdAt: new Date().toISOString() }); save(store); return { email, name }; }
export function login(email: string, password: string) { const store = load(); const account = store.accounts.find((a) => a.email === email); if (!account || !verify(password, account.passwordHash)) return null; return { email: account.email, name: account.name }; }
export function createSession(email: string) { const store = load(); const token = crypto.randomBytes(32).toString("hex"); store.sessions[token] = { email, expiresAt: Date.now() + SESSION_TTL_MS }; save(store); return token; }
export function session(token?: string) { if (!token) return null; const store = load(); const current = store.sessions[token]; if (!current || current.expiresAt < Date.now()) return null; const account = store.accounts.find((a) => a.email === current.email); if (!account) return null; if (current.expiresAt - Date.now() < SESSION_TTL_MS / 2) { current.expiresAt = Date.now() + SESSION_TTL_MS; save(store); } return { email: account.email, name: account.name }; }
export function destroySession(token?: string) { if (!token) return; const store = load(); delete store.sessions[token]; save(store); }
