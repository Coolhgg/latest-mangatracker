import { prisma, withRetry } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export type PaginationParams = {
  page?: number;
  limit?: number;
};

export type NotificationFilters = {
  unreadOnly?: boolean;
  type?: string;
};

export async function getNotifications(
  userId: string,
  { page = 1, limit = 20, unreadOnly = false, type }: PaginationParams & NotificationFilters = {}
) {
  const skip = (page - 1) * limit;
  const where: Prisma.NotificationWhereInput = {
    user_id: userId,
    ...(unreadOnly && { read_at: null }),
    ...(type && { type }),
  };

  const [items, total] = await withRetry(() => Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
      include: {
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
          },
        },
        chapter: {
          select: {
            id: true,
            chapter_number: true,
            chapter_title: true,
          },
        },
        actor: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
          },
        },
      },
    }),
    prisma.notification.count({ where }),
  ]));

  const unreadCount = unreadOnly
    ? total
    : await withRetry(() => prisma.notification.count({
        where: { user_id: userId, read_at: null },
      }));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    unreadCount,
  };
}

export async function markNotificationsAsRead(userId: string, notificationId?: string) {
  if (notificationId) {
    return withRetry(() => prisma.notification.update({
      where: { id: notificationId, user_id: userId },
      data: { read_at: new Date() },
    }));
  }

  return withRetry(() => prisma.notification.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  }));
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return withRetry(() => prisma.notification.count({
    where: { user_id: userId, read_at: null },
  }));
}

export async function getFollowers(
  username: string,
  { page = 1, limit = 20 }: PaginationParams = {},
  viewerId?: string
) {
  const skip = (page - 1) * limit;

  const user = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: username, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true, privacy_settings: true },
  }));

  if (!user) throw new Error("User not found");

  // Privacy check: if viewer is not the user themselves, check privacy settings
  if (viewerId !== user.id) {
    const privacySettings = user.privacy_settings as { followers_public?: boolean } | null;
    if (privacySettings?.followers_public === false) {
      throw new Error("Followers list is private");
    }
  }

  const [items, total] = await withRetry(() => Promise.all([
    prisma.follow.findMany({
      where: { following_id: user.id },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
            bio: true,
          },
        },
      },
    }),
    prisma.follow.count({ where: { following_id: user.id } }),
  ]));

  return {
    items: items.map((f) => f.follower),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getFollowing(
  username: string,
  { page = 1, limit = 20 }: PaginationParams = {},
  viewerId?: string
) {
  const skip = (page - 1) * limit;

  const user = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: username, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true, privacy_settings: true },
  }));

  if (!user) throw new Error("User not found");

  // Privacy check: if viewer is not the user themselves, check privacy settings
  if (viewerId !== user.id) {
    const privacySettings = user.privacy_settings as { following_public?: boolean } | null;
    if (privacySettings?.following_public === false) {
      throw new Error("Following list is private");
    }
  }

  const [items, total] = await withRetry(() => Promise.all([
    prisma.follow.findMany({
      where: { follower_id: user.id },
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
      include: {
        following: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
            bio: true,
          },
        },
      },
    }),
    prisma.follow.count({ where: { follower_id: user.id } }),
  ]));

  return {
    items: items.map((f) => f.following),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function checkFollowStatus(followerId: string, followingId: string): Promise<boolean> {
  const follow = await withRetry(() => prisma.follow.findUnique({
    where: {
      follower_id_following_id: {
        follower_id: followerId,
        following_id: followingId,
      },
    },
  }));

  return !!follow;
}

export async function followUser(followerId: string, targetUsername: string) {
  const target = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: targetUsername, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true },
  }));

  if (!target) throw new Error("Target user not found");
  if (target.id === followerId) throw new Error("Cannot follow yourself");

  // FIX: Use upsert pattern to handle race conditions
  // This atomically creates or returns existing follow record
  try {
    const follow = await withRetry(() => prisma.follow.upsert({
      where: {
        follower_id_following_id: {
          follower_id: followerId,
          following_id: target.id,
        },
      },
      create: {
        follower_id: followerId,
        following_id: target.id,
      },
      update: {}, // No-op if already exists
    }));

    // Only create notification if this is a new follow (check if created recently)
    const isNewFollow = Date.now() - new Date(follow.created_at).getTime() < 1000;
    
    if (isNewFollow) {
      // Create notification for target user
      await withRetry(() => prisma.notification.create({
        data: {
          user_id: target.id,
          actor_user_id: followerId,
          type: "new_follower",
          title: "New Follower",
          message: "started following you",
        },
      }));

      // Log activity
      await withRetry(() => prisma.activity.create({
        data: {
          user_id: followerId,
          type: "user_followed",
          metadata: { following_id: target.id, following_username: targetUsername },
        },
      }));
    }

    return follow;
  } catch (error: any) {
    // Handle unique constraint error as a fallback (shouldn't happen with upsert but just in case)
    if (error.code === 'P2002') {
      return withRetry(() => prisma.follow.findUnique({
        where: {
          follower_id_following_id: {
            follower_id: followerId,
            following_id: target.id,
          },
        },
      }));
    }
    throw error;
  }
}

export async function unfollowUser(followerId: string, targetUsername: string) {
  const target = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: targetUsername, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true },
  }));

  if (!target) throw new Error("Target user not found");

  const result = await withRetry(() => prisma.follow.deleteMany({
    where: {
      follower_id: followerId,
      following_id: target.id,
    },
  }));

  return result;
}


export async function getActivityFeed(
  userId: string | null,
  {
    page = 1,
    limit = 20,
    type = "global",
    viewerId,
  }: PaginationParams & {
    type?: "global" | "following" | "personal";
    viewerId?: string;
  } = {}
) {
  const skip = (page - 1) * limit;

  let where: Prisma.ActivityWhereInput = {};

  if (type === "personal" && userId) {
    // Personal feed: only show user's own activities
    where = { user_id: userId };
  } else if (type === "following" && userId) {
    // Following feed: show activities from users being followed
    const following = await withRetry(() => prisma.follow.findMany({
      where: { follower_id: userId },
      select: { following_id: true },
    }));
    const followingIds = following.map((f) => f.following_id);

    if (followingIds.length === 0) {
      // No following, return empty feed
      return {
        items: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
        },
      };
    }

    where = {
      user_id: { in: followingIds },
      user: {
        privacy_settings: {
          path: ["activity_public"],
          equals: true,
        },
      },
    };
  } else {
    // Global feed - only show public activities
    where = {
      user: {
        privacy_settings: {
          path: ["activity_public"],
          equals: true,
        },
      },
    };
  }

  // Additional privacy filtering: if viewing someone else's personal feed
  if (type === "personal" && userId && viewerId && userId !== viewerId) {
    const user = await withRetry(() => prisma.user.findUnique({
      where: { id: userId },
      select: { privacy_settings: true },
    }));

    if (user) {
      const privacySettings = user.privacy_settings as { activity_public?: boolean } | null;
      if (privacySettings?.activity_public === false) {
        // Activity is private, return empty feed
        return {
          items: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0,
          },
        };
      }
    }
  }

  const [items, total] = await withRetry(() => Promise.all([
    prisma.activity.findMany({
      where,
      orderBy: { created_at: "desc" },
      skip,
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
          },
        },
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
          },
        },
        chapter: {
          select: {
            id: true,
            chapter_number: true,
            chapter_title: true,
          },
        },
      },
    }),
    prisma.activity.count({ where }),
  ]));

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

