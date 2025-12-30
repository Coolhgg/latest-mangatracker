import { supabaseAdmin } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, sanitizeInput } from "@/lib/api-utils"

/**
 * SECURITY: Escape ILIKE special characters to prevent SQL injection
 * Characters %, _, and \ have special meaning in ILIKE patterns
 */
function escapeILikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/%/g, '\\%')    // Escape percent signs
    .replace(/_/g, '\\_')    // Escape underscores
}

export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute per IP
  const ip = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown"
  if (!checkRateLimit(`search:${ip}`, 60, 60000)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const rawQuery = searchParams.get('q')?.trim()
  const type = searchParams.get('type')
  const status = searchParams.get('status')
  const genres = searchParams.get('genres')?.split(',').filter(Boolean)
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20')), 100)
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))
  const sortBy = searchParams.get('sort') || 'relevance'

  // Sanitize and validate query
  const query = rawQuery ? sanitizeInput(rawQuery, 200) : null

  if (!query && !type && !status && (!genres || genres.length === 0)) {
    return NextResponse.json({ 
      results: [], 
      total: 0,
      message: 'No filters provided' 
    })
  }

  try {
    // Build Supabase query
    let supabaseQuery = supabaseAdmin
      .from('series')
      .select(`
        id,
        title,
        alternative_titles,
        description,
        cover_url,
        type,
        status,
        genres,
        total_follows,
        total_views,
        average_rating,
        updated_at,
        chapters (id)
      `, { count: 'exact' })

    if (query) {
      // SECURITY: Escape ILIKE special characters to prevent pattern injection
      const escapedQuery = escapeILikePattern(query)
      supabaseQuery = supabaseQuery.or(`title.ilike.%${escapedQuery}%,description.ilike.%${escapedQuery}%`)
    }

    if (type) {
      supabaseQuery = supabaseQuery.eq('type', type)
    }

    if (status) {
      supabaseQuery = supabaseQuery.eq('status', status)
    }

    if (genres && genres.length > 0) {
      supabaseQuery = supabaseQuery.contains('genres', genres)
    }

    // Sorting
    let sortColumn = 'total_follows'
    let ascending = false

    switch (sortBy) {
      case 'rating':
        sortColumn = 'average_rating'
        break
      case 'updated':
        sortColumn = 'updated_at'
        break
      case 'views':
        sortColumn = 'total_views'
        break
      case 'title':
        sortColumn = 'title'
        ascending = true
        break
    }

    const { data: results, count, error } = await supabaseQuery
      .order(sortColumn, { ascending })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({
      results: (results || []).map((s: any) => ({
        ...s,
        chapter_count: s.chapters?.length || 0,
        chapters: undefined
      })),
      total: count || 0,
      limit,
      offset,
      has_more: offset + (results?.length || 0) < (count || 0)
    })

  } catch (error: any) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: error.message },
      { status: 500 }
    )
  }
}
