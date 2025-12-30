import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFollowers } from "@/lib/social-utils";
import { checkRateLimit, validateUsername } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`followers:${ip}`, 30, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    const { username } = await params;

    // Validate username format to prevent injection
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20")));

    const followers = await getFollowers(username, { page, limit }, user?.id);

    return NextResponse.json(followers);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (error.message?.includes("private")) {
      return NextResponse.json({ error: "Followers list is private" }, { status: 403 });
    }
    console.error("Followers fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch followers" }, { status: 500 });
  }
}
