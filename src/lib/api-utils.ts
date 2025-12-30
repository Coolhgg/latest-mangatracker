import { NextResponse } from 'next/server'

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export function handleApiError(error: unknown): NextResponse {
  if (process.env.NODE_ENV !== 'test') {
    console.error('[API Error]:', error)
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    )
  }

  if (error instanceof Error) {
    const lowerMessage = error.message.toLowerCase()
    
    if (lowerMessage.includes('not found')) {
      return NextResponse.json(
        { error: error.message, code: ErrorCodes.NOT_FOUND },
        { status: 404 }
      )
    }
    if (lowerMessage.includes('unauthorized')) {
      return NextResponse.json(
        { error: error.message, code: ErrorCodes.UNAUTHORIZED },
        { status: 401 }
      )
    }
    if (lowerMessage.includes('forbidden') || lowerMessage.includes('private')) {
      return NextResponse.json(
        { error: error.message, code: ErrorCodes.FORBIDDEN },
        { status: 403 }
      )
    }
    if (error.name === 'PrismaClientKnownRequestError') {
      const prismaError = error as any
      if (prismaError.code === 'P2002') {
        return NextResponse.json(
          { error: 'Resource already exists', code: ErrorCodes.CONFLICT },
          { status: 409 }
        )
      }
      if (prismaError.code === 'P2025') {
        return NextResponse.json(
          { error: 'Resource not found', code: ErrorCodes.NOT_FOUND },
          { status: 404 }
        )
      }
    }
    return NextResponse.json(
      { error: error.message, code: ErrorCodes.INTERNAL_ERROR },
      { status: 500 }
    )
  }

  return NextResponse.json(
    { error: 'An unexpected error occurred', code: ErrorCodes.INTERNAL_ERROR },
    { status: 500 }
  )
}

export function validateRequired(
  data: Record<string, unknown>,
  fields: string[]
): void {
  const missing = fields.filter((field) => !data[field])
  if (missing.length > 0) {
    throw new ApiError(`Missing required fields: ${missing.join(', ')}`, 400, 'MISSING_FIELDS')
  }
}

export function validateUUID(id: string, fieldName = 'id'): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(id)) {
    throw new ApiError(`Invalid ${fieldName} format`, 400, 'INVALID_FORMAT')
  }
}

/**
 * Sanitizes user input to prevent XSS attacks
 * Removes HTML tags and dangerous patterns
 */
export function sanitizeInput(input: string, maxLength = 10000): string {
  return input
    .trim()
    .slice(0, maxLength)
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove event handlers
    .replace(/on\w+\s*=/gi, '')
}

/**
 * HTML encode special characters for safe display
 */
export function htmlEncode(input: string): string {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  }
  return input.replace(/[&<>"']/g, (char) => entities[char] || char)
}

/**
 * Sanitizes text for bio fields etc - just trims and limits length
 */
export function sanitizeText(input: string, maxLength = 500): string {
  return input.trim().slice(0, maxLength)
}

export function parsePaginationParams(
  searchParams: URLSearchParams
): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
  const offset = parseInt(searchParams.get('offset') || '0', 10)
  const actualPage = offset > 0 ? Math.floor(offset / limit) + 1 : page
  
  return { page: actualPage, limit, offset: (actualPage - 1) * limit }
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export function validateUsername(username: string): boolean {
  const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/
  return usernameRegex.test(username)
}

export function createSuccessResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status })
}

export function createPaginatedResponse<T>(
  items: T[],
  pagination: { page: number; limit: number; total: number }
): NextResponse {
  return NextResponse.json({
    items,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.limit),
      hasMore: pagination.page * pagination.limit < pagination.total,
    },
  })
}

// Rate limiting with automatic cleanup
interface RateLimitEntry {
  count: number
  resetTime: number
}

class RateLimitStore {
  private map = new Map<string, RateLimitEntry>()
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor() {
    // Cleanup stale entries every 5 minutes
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000)
    }
  }

  get(key: string): RateLimitEntry | undefined {
    return this.map.get(key)
  }

  set(key: string, entry: RateLimitEntry): void {
    this.map.set(key, entry)
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.map.entries()) {
      if (now > entry.resetTime) {
        this.map.delete(key)
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.map.clear()
  }
}

const rateLimitStore = new RateLimitStore()

export function checkRateLimit(
  key: string,
  maxRequests: number = 100,
  windowMs: number = 60000
): boolean {
  const now = Date.now()
  const record = rateLimitStore.get(key)

  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs })
    return true
  }

  if (record.count >= maxRequests) {
    return false
  }

  record.count++
  return true
}

export function clearRateLimit(key: string): void {
  rateLimitStore.delete(key)
}

/**
 * Auth-specific rate limiting (stricter limits)
 */
export function checkAuthRateLimit(ip: string): boolean {
  // 5 attempts per minute for auth endpoints
  return checkRateLimit(`auth:${ip}`, 5, 60000)
}

export async function withErrorHandling<T>(
  handler: () => Promise<T>
): Promise<NextResponse> {
  try {
    const result = await handler()
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error)
  }
}
