import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { followUser, unfollowUser, checkFollowStatus } from "@/lib/social-utils";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, validateUsername } from "@/lib/api-utils";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 60 requests per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`follow-status:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { username } = await params;

    // Validate username format
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    // Get target user ID with case-insensitivity
    const target = await prisma.user.findFirst({
      where: { 
        username: { 
          equals: username, 
          mode: 'insensitive' 
        } 
      },
      select: { id: true },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const isFollowing = await checkFollowStatus(user.id, target.id);

    return NextResponse.json({ isFollowing });
  } catch (error: any) {
    console.error("Follow status error:", error);
    return NextResponse.json({ error: "Failed to check follow status" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 follow actions per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`follow-action:${ip}`, 30, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { username } = await params;

    // Validate username format
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    const follow = await followUser(user.id, username);

    return NextResponse.json(follow, { status: 201 });
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (error.message?.includes("yourself")) {
      return NextResponse.json({ error: "Cannot follow yourself" }, { status: 400 });
    }
    console.error("Follow error:", error);
    return NextResponse.json({ error: "Failed to follow user" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    // Rate limit: 30 unfollow actions per minute per IP
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`follow-action:${ip}`, 30, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { username } = await params;

    // Validate username format
    if (!validateUsername(username)) {
      return NextResponse.json(
        { error: "Invalid username format" },
        { status: 400 }
      );
    }

    await unfollowUser(user.id, username);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.error("Unfollow error:", error);
    return NextResponse.json({ error: "Failed to unfollow user" }, { status: 500 });
  }
}
