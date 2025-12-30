import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNotifications, markNotificationsAsRead } from "@/lib/social-utils";
import { checkRateLimit } from "@/lib/api-utils";

const VALID_TYPES = ['new_chapter', 'new_follower', 'achievement', 'system'] as const;

export async function GET(request: Request) {
  try {
    // Rate limit
    const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`notifications:${ip}`, 60, 60000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment.' },
        { status: 429 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "20")), 100);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const type = searchParams.get("type") || undefined;

    // Validate type if provided
    if (type && !VALID_TYPES.includes(type as any)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const notifications = await getNotifications(user.id, {
      page,
      limit,
      unreadOnly,
      type,
    });

    return NextResponse.json(notifications);
  } catch (error: any) {
    console.error('Notifications fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { markAll } = body;

    if (markAll !== true) {
      return NextResponse.json(
        { error: "Invalid request. Use { markAll: true } to mark all as read" },
        { status: 400 }
      );
    }

    await markNotificationsAsRead(user.id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Notifications update error:', error);
    return NextResponse.json({ error: 'Failed to update notifications' }, { status: 500 });
  }
}
