
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/gamification/activity';
import { XP_PER_CHAPTER, calculateLevel } from '@/lib/gamification/xp';
import { calculateNewStreak, calculateStreakBonus } from '@/lib/gamification/streaks';
import { checkAchievements } from '@/lib/gamification/achievements';
import { validateUUID } from '@/lib/api-utils';

/**
 * PATCH /api/library/[id]/progress
 * Marks a chapter as read, updates streak and XP
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: entryId } = await params;

    // Validate UUID format
    try {
      validateUUID(entryId, 'entryId');
    } catch {
      return NextResponse.json({ error: 'Invalid entry ID format' }, { status: 400 });
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { chapterNumber } = body;

    if (chapterNumber === undefined || typeof chapterNumber !== 'number' || chapterNumber < 0 || !Number.isFinite(chapterNumber)) {
      return NextResponse.json({ error: 'Valid chapter number is required (non-negative number)' }, { status: 400 });
    }

    // Cap chapter number to reasonable limit
    if (chapterNumber > 100000) {
      return NextResponse.json({ error: 'Chapter number exceeds maximum limit' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Get current entry and user profile
      const entry = await tx.libraryEntry.findUnique({
        where: { id: entryId, user_id: user.id },
        include: { series: true }
      });

      if (!entry) {
        throw new Error('Library entry not found');
      }

      // Check if trying to mark an older chapter as read
      const currentLastRead = Number(entry.last_read_chapter || 0);
      const isNewChapter = chapterNumber > currentLastRead;

      const userProfile = await tx.user.findUnique({
        where: { id: user.id },
      });

      if (!userProfile) {
        throw new Error('User profile not found');
      }

      // 2. Calculate new streak and XP
      const newStreak = calculateNewStreak(userProfile.streak_days, userProfile.last_read_at);
      const streakBonus = calculateStreakBonus(newStreak);
      const totalXpGained = isNewChapter ? (XP_PER_CHAPTER + streakBonus) : 0;

      // 3. Update Library Entry
      const updatedEntry = await tx.libraryEntry.update({
        where: { id: entryId },
        data: {
          last_read_chapter: isNewChapter ? chapterNumber : entry.last_read_chapter,
          last_read_at: new Date(),
        },
      });

      // 4. Update User Profile (XP, Level, Streak)
      const newXp = (userProfile.xp || 0) + totalXpGained;
      const newLevel = calculateLevel(newXp);

      // Update longest streak if current is higher
      const longestStreak = Math.max(userProfile.longest_streak || 0, newStreak);

      await tx.user.update({
        where: { id: user.id },
        data: {
          xp: newXp,
          level: newLevel,
          streak_days: newStreak,
          longest_streak: longestStreak,
          last_read_at: new Date(),
          chapters_read: { increment: isNewChapter ? 1 : 0 },
        },
      });

      // 5. Log Activity
      await logActivity(tx, user.id, 'chapter_read', {
        seriesId: entry.series_id,
        metadata: { 
          chapter_number: chapterNumber,
          xp_gained: totalXpGained,
          streak: newStreak
        },
      });

      // 6. Check Achievements
      await checkAchievements(tx, user.id, 'chapter_read');
      if (newStreak > userProfile.streak_days) {
        await checkAchievements(tx, user.id, 'streak_reached');
      }

      return {
        entry: updatedEntry,
        xp_gained: totalXpGained,
        new_streak: newStreak,
        new_level: newLevel
      };
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Progress update error:', error);
    if (error.message === 'Library entry not found' || error.message === 'User profile not found') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
  }
}
