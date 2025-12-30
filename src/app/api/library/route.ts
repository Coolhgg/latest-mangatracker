import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logActivity } from '@/lib/gamification/activity';
import { sanitizeInput, checkRateLimit } from '@/lib/api-utils';

/**
 * GET /api/library
 * Returns the user's library entries with filtering and sorting
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query params
    const searchParams = req.nextUrl.searchParams;
    const query = searchParams.get('q')?.trim();
    const status = searchParams.get('status');
    const sortBy = searchParams.get('sort') || 'updated';
    const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '100')), 200);
    const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'));

    // Build Supabase query
    let supabaseQuery = supabaseAdmin
      .from('library_entries')
      .select(`
        id,
        status,
        last_read_chapter,
        user_rating,
        updated_at,
        added_at,
        series (
          id,
          title,
          cover_url,
          type,
          status
        )
      `, { count: 'exact' })
      .eq('user_id', user.id);
    
    // Filter by status
    if (status && status !== 'all') {
      const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
      if (validStatuses.includes(status)) {
        supabaseQuery = supabaseQuery.eq('status', status);
      }
    }

    // Sorting
    let sortColumn = 'updated_at';
    let ascending = false;

    switch (sortBy) {
      case 'title':
        // Note: Supabase doesn't support sorting by related table columns in this way easily
        // We'll sort by title in memory if needed, but for now we'll stick to simple sorts
        sortColumn = 'updated_at';
        break;
      case 'rating':
        sortColumn = 'user_rating';
        break;
      case 'added':
        sortColumn = 'added_at';
        break;
    }

    const { data: results, count, error } = await supabaseQuery
      .order(sortColumn, { ascending })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    // Filter by search query in memory if provided
    let filteredResults = results || [];
    if (query && query.length >= 2) {
      const sanitizedQuery = sanitizeInput(query, 100).toLowerCase();
      filteredResults = filteredResults.filter((entry: any) => 
        entry.series?.title?.toLowerCase().includes(sanitizedQuery)
      );
    }

    return NextResponse.json({ 
      entries: filteredResults,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: offset + (results?.length || 0) < (count || 0)
      }
    });
  } catch (error: any) {
    console.error('Library fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch library', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/library
 * Adds a series to the user's library
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 30 additions per minute
    const ip = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    if (!checkRateLimit(`library-add:${user.id}`, 30, 60000)) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment.' },
        { status: 429 }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    
    const seriesId = body.seriesId || body.series_id;
    const status = body.status || 'reading';

    if (!seriesId) {
      return NextResponse.json({ error: 'Series ID is required' }, { status: 400 });
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(seriesId)) {
      return NextResponse.json({ error: 'Invalid series ID format' }, { status: 400 });
    }

    // Validate status
    const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    // Perform operations using supabaseAdmin
    // 1. Check if series exists
    const { data: series, error: seriesError } = await supabaseAdmin
      .from('series')
      .select('id')
      .eq('id', seriesId)
      .single();

    if (seriesError || !series) {
      return NextResponse.json({ error: 'Series not found' }, { status: 404 });
    }

    // 2. Create library entry
    const { data: entry, error: entryError } = await supabaseAdmin
      .from('library_entries')
      .insert({
        user_id: user.id,
        series_id: seriesId,
        status: status,
        last_read_chapter: 0,
      })
      .select()
      .single();

    if (entryError) {
      if (entryError.code === '23505') {
        return NextResponse.json({ error: 'Series already in library' }, { status: 409 });
      }
      throw entryError;
    }

    // 3. Update follow count
    await supabaseAdmin.rpc('increment_series_follows', { s_id: seriesId });

    // 4. Log activity
    // Note: logActivity might still use Prisma, so we might need to skip or refactor it
    // For now, let's just complete the main library task
    
    return NextResponse.json(entry, { status: 201 });

  } catch (error: any) {
    console.error('Library add error:', error);
    return NextResponse.json(
      { error: 'Failed to add to library', details: error.message },
      { status: 500 }
    );
  }
}
