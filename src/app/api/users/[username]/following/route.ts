import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getFollowing } from "@/lib/social-utils";
import { checkRateLimit, validateUsername } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`following:${ip}`, 30, 60000)) {
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

    const following = await getFollowing(username, { page, limit }, user?.id);

    return NextResponse.json(following);
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (error.message?.includes("private")) {
      return NextResponse.json({ error: "Following list is private" }, { status: 403 });
    }
    console.error("Following fetch error:", error);
    return NextResponse.json({ error: "Failed to fetch following" }, { status: 500 });
  }
}
