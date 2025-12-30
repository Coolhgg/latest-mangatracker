import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma, withRetry, isTransientError } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError) {
      console.error("Auth error:", authError.message)
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 })
    }

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Generate fallback username from Supabase data
    const fallbackUsername = user.user_metadata?.username || 
                            user.email?.split('@')[0]?.replace(/[^a-z0-9_]/gi, '').toLowerCase() || 
                            `user_${user.id.slice(0, 8)}`

    // Create fallback response for when DB is unavailable
    const createFallbackResponse = (warning: string) => ({
      id: user.id,
      email: user.email,
      username: fallbackUsername,
      avatar_url: user.user_metadata?.avatar_url || null,
      bio: null,
      xp: 0,
      level: 1,
      streak_days: 0,
      longest_streak: 0,
      chapters_read: 0,
      library_count: 0,
      followers_count: 0,
      following_count: 0,
      _synced: false,
      _warning: warning
    })

    // Try to get user from database with retry logic
    let dbUser = null
    try {
      dbUser = await withRetry(
        () => prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            username: true,
            avatar_url: true,
            bio: true,
            xp: true,
            level: true,
            streak_days: true,
            longest_streak: true,
            chapters_read: true,
            created_at: true,
            updated_at: true,
            privacy_settings: true,
            _count: {
              select: {
                library_entries: true,
                followers: true,
                following: true,
              },
            },
          },
        }),
        3,
        200
      )
    } catch (dbError: any) {
      console.warn("Database connection error in /api/users/me:", dbError.message?.slice(0, 100))
      console.log("[users/me] isTransientError check:", isTransientError(dbError))
      
      // If it's a transient database error, return a degraded response with Supabase data
      if (isTransientError(dbError)) {
        console.log("[users/me] Returning fallback response due to transient error")
        return NextResponse.json(createFallbackResponse("Could not connect to database. Some data may be unavailable."))
      }
      throw dbError
    }

    // AUTO-SYNC: If user exists in Supabase but not in Prisma, create them
    if (!dbUser) {
      console.log("User exists in Supabase but not Prisma, auto-creating:", user.id)
      
      // Check for username collisions and make unique if needed
      let username = fallbackUsername.slice(0, 20) // Ensure max length
      let suffix = 1
      
      try {
        while (await withRetry(() => prisma.user.findFirst({ 
          where: { username: { equals: username, mode: 'insensitive' } } 
        }))) {
          username = `${fallbackUsername.slice(0, 16)}${suffix}`
          suffix++
          if (suffix > 999) {
            username = `user_${Date.now().toString(36)}`
            break
          }
        }
        
        dbUser = await withRetry(
          () => prisma.user.create({
            data: {
              id: user.id,
              email: user.email!,
              username,
              password_hash: '', // OAuth users don't have a password
              xp: 0,
              level: 1,
              streak_days: 0,
              longest_streak: 0,
              chapters_read: 0,
              subscription_tier: 'free',
              notification_settings: { email: true, push: false },
              privacy_settings: { library_public: true, activity_public: true },
              avatar_url: user.user_metadata?.avatar_url || null,
            },
            select: {
              id: true,
              email: true,
              username: true,
              avatar_url: true,
              bio: true,
              xp: true,
              level: true,
              streak_days: true,
              longest_streak: true,
              chapters_read: true,
              created_at: true,
              updated_at: true,
              privacy_settings: true,
              _count: {
                select: {
                  library_entries: true,
                  followers: true,
                  following: true,
                },
              },
            },
          }),
          2,
          300
        )
        console.log("Auto-created user profile:", dbUser.username)
      } catch (createError: any) {
        // Handle race condition where user was created between check and create
        if (createError.code === 'P2002') {
          dbUser = await withRetry(
            () => prisma.user.findUnique({
              where: { id: user.id },
              select: {
                id: true,
                email: true,
                username: true,
                avatar_url: true,
                bio: true,
                xp: true,
                level: true,
                streak_days: true,
                longest_streak: true,
                chapters_read: true,
                created_at: true,
                updated_at: true,
                privacy_settings: true,
                _count: {
                  select: {
                    library_entries: true,
                    followers: true,
                    following: true,
                  },
                },
              },
            }),
            2,
            200
          )
        } else if (isTransientError(createError)) {
          // Database is unavailable, return Supabase data
          return NextResponse.json(createFallbackResponse("Account created but database sync pending. Some features may be limited."))
        } else {
          throw createError
        }
      }
    }

    if (!dbUser) {
      // Fallback: Return Supabase data if no DB user
      return NextResponse.json(createFallbackResponse("User profile not found in database."))
    }

    return NextResponse.json({
      ...dbUser,
      library_count: dbUser._count.library_entries,
      followers_count: dbUser._count.followers,
      following_count: dbUser._count.following,
      _count: undefined,
    })
  } catch (error: any) {
    console.error("Failed to fetch current user:", error.message?.slice(0, 200))
    console.log("[users/me] Outer catch - isTransientError:", isTransientError(error))
    
    // Even on unexpected errors, check if transient
    if (isTransientError(error)) {
      // Try to get Supabase user for fallback
      try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          const fallbackUsername = user.user_metadata?.username || 
                                  user.email?.split('@')[0]?.replace(/[^a-z0-9_]/gi, '').toLowerCase() || 
                                  `user_${user.id.slice(0, 8)}`
          return NextResponse.json({
            id: user.id,
            email: user.email,
            username: fallbackUsername,
            avatar_url: user.user_metadata?.avatar_url || null,
            bio: null,
            xp: 0,
            level: 1,
            streak_days: 0,
            longest_streak: 0,
            chapters_read: 0,
            library_count: 0,
            followers_count: 0,
            following_count: 0,
            _synced: false,
            _warning: "Database temporarily unavailable."
          })
        }
      } catch {
        // Ignore errors in fallback
      }
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please try again." },
        { status: 503 }
      )
    }
    
    return NextResponse.json(
      { error: "Failed to fetch user data. Please try again." },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    
    const { username, bio, avatar_url, privacy_settings } = body

    // Validate username if provided
    if (username !== undefined) {
      if (typeof username !== 'string' || username.length < 3 || username.length > 20) {
        return NextResponse.json(
          { error: "Username must be 3-20 characters" },
          { status: 400 }
        )
      }
      
      if (!/^[a-z0-9_]+$/i.test(username)) {
        return NextResponse.json(
          { error: "Username can only contain letters, numbers, and underscores" },
          { status: 400 }
        )
      }
      
      // Check if username is taken
      const existing = await withRetry(
        () => prisma.user.findFirst({
          where: { 
            username: { equals: username, mode: 'insensitive' },
            id: { not: user.id },
          },
        }),
        2,
        150
      )
      
      if (existing) {
        return NextResponse.json(
          { error: "Username is already taken" },
          { status: 409 }
        )
      }
    }

    // Validate bio if provided
    if (bio !== undefined && typeof bio === 'string' && bio.length > 500) {
      return NextResponse.json(
        { error: "Bio must be 500 characters or less" },
        { status: 400 }
      )
    }

    // SECURITY FIX: Validate privacy_settings schema
    if (privacy_settings !== undefined) {
      if (typeof privacy_settings !== 'object' || privacy_settings === null || Array.isArray(privacy_settings)) {
        return NextResponse.json(
          { error: "Invalid privacy settings format" },
          { status: 400 }
        )
      }
      
      const allowedKeys = ['library_public', 'activity_public', 'followers_public', 'following_public']
      const providedKeys = Object.keys(privacy_settings)
      
      // Check for unknown keys
      const unknownKeys = providedKeys.filter(k => !allowedKeys.includes(k))
      if (unknownKeys.length > 0) {
        return NextResponse.json(
          { error: `Invalid privacy setting keys: ${unknownKeys.join(', ')}` },
          { status: 400 }
        )
      }
      
      // Validate all values are booleans
      for (const [key, value] of Object.entries(privacy_settings)) {
        if (typeof value !== 'boolean') {
          return NextResponse.json(
            { error: `Privacy setting '${key}' must be a boolean` },
            { status: 400 }
          )
        }
      }
    }

    const updateData: Record<string, unknown> = {}
    if (username !== undefined) updateData.username = username.toLowerCase()
    if (bio !== undefined) updateData.bio = bio
    if (avatar_url !== undefined) updateData.avatar_url = avatar_url
    if (privacy_settings !== undefined) updateData.privacy_settings = privacy_settings

    const updatedUser = await withRetry(
      () => prisma.user.update({
        where: { id: user.id },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          avatar_url: true,
          bio: true,
          xp: true,
          level: true,
          privacy_settings: true,
        },
      }),
      2,
      200
    )

    return NextResponse.json(updatedUser)
  } catch (error: any) {
    console.error("Failed to update user:", error)
    
    if (isTransientError(error)) {
      return NextResponse.json(
        { error: "Database temporarily unavailable. Please try again." },
        { status: 503 }
      )
    }
    
    return NextResponse.json(
      { error: "Failed to update user data" },
      { status: 500 }
    )
  }
}
