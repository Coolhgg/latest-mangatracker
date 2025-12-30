import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const [followingData, followersData] = await Promise.all([
      prisma.follow.findMany({
        where: { follower_id: user.id },
        include: {
          following: {
            select: {
              id: true,
              username: true,
              avatar_url: true,
              xp: true,
              level: true,
            },
          },
        },
      }),
      prisma.follow.findMany({
        where: { following_id: user.id },
        include: {
          follower: {
            select: {
              id: true,
              username: true,
              avatar_url: true,
              xp: true,
              level: true,
            },
          },
        },
      }),
    ])

    const followingIds = new Set(followingData.map((f) => f.following_id))

    const suggested = await prisma.user.findMany({
      where: {
        id: {
          notIn: [...Array.from(followingIds), user.id],
        },
      },
      select: {
        id: true,
        username: true,
        avatar_url: true,
        xp: true,
        level: true,
      },
      orderBy: { xp: "desc" },
      take: 6,
    })

    return NextResponse.json({
      following: followingData.map((f) => ({
        id: f.id,
        user: f.following,
      })),
      followers: followersData.map((f) => ({
        id: f.id,
        user: f.follower,
      })),
      suggested,
    })
  } catch (error) {
    console.error("Failed to fetch social data:", error)
    return NextResponse.json(
      { error: "Failed to fetch social data" },
      { status: 500 }
    )
  }
}
