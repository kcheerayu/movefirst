import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { isPreviewEnabled } from "@/lib/data/preview";

export async function POST(request: Request) {
  // Preview identities are in-memory only. This deliberately does not claim a session was revoked.
  if (isPreviewEnabled()) return NextResponse.redirect(new URL("/login?preview=returned", request.url), 303);
  const supabase = await createServerClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
