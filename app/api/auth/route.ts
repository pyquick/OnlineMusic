import { NextResponse } from "next/server";
import { createSession, destroySession, login, register, session, SESSION_TTL_MS } from "@/lib/accounts";
import { applyCors, denyCrossSite, optionsResponse, sessionCookie } from "@/lib/cors";
export const dynamic = "force-dynamic";
const TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const sessionToken = (request: Request) => request.headers.get("cookie")?.match(/(?:^|; )session=([^;]+)/)?.[1];

export const OPTIONS = (request: Request) => optionsResponse(request);

export async function GET(request: Request) {
  const token = sessionToken(request);
  const user = session(token);
  const response = NextResponse.json({ user });
  if (user && token) response.headers.set("Set-Cookie", sessionCookie(request, token, TTL_SECONDS));
  return applyCors(request, response);
}

export async function POST(request: Request) {
  if (denyCrossSite(request)) return applyCors(request, NextResponse.json({ error: "This server does not accept requests from that origin" }, { status: 403 }));
  try {
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || email.split("@")[0] || "User").trim();
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 6) return applyCors(request, NextResponse.json({ error: "Enter a valid email and a password of at least 6 characters" }, { status: 400 }));
    const user = body.mode === "register" ? register(email, password, name) : login(email, password);
    if (!user) return applyCors(request, NextResponse.json({ error: body.mode === "register" ? "That email is already registered" : "Email or password is incorrect" }, { status: 401 }));
    const response = NextResponse.json({ user });
    response.headers.set("Set-Cookie", sessionCookie(request, createSession(user.email), TTL_SECONDS));
    return applyCors(request, response);
  } catch {
    return applyCors(request, NextResponse.json({ error: "Invalid request" }, { status: 400 }));
  }
}

export async function DELETE(request: Request) {
  if (denyCrossSite(request)) return applyCors(request, NextResponse.json({ error: "This server does not accept requests from that origin" }, { status: 403 }));
  destroySession(sessionToken(request));
  const response = NextResponse.json({ ok: true });
  // The clearing cookie carries the same policy as the session one, or it could not overwrite it.
  response.headers.set("Set-Cookie", sessionCookie(request, "", 0));
  return applyCors(request, response);
}
