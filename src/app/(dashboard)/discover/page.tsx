"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Search, Star, Users, Flame, BookOpen, TrendingUp, Loader2, X, AlertCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useSearchParams } from "next/navigation"
import { useDebounce } from "@/hooks/use-performance"

interface Series {
  id: string
  title: string
  cover_url: string | null
  type: string
  status: string
  genres: string[]
  average_rating: number | null
  total_follows: number
}

const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror", 
  "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural"
]

const TYPES = ["manga", "manhwa", "manhua", "webtoon"]

function SeriesSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[3/4] rounded-2xl" />
          <div className="space-y-2 px-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SeriesCard({ series, index }: { series: Series; index?: number }) {
  return (
    <Link href={`/series/${series.id}`} className="group space-y-3 relative">
      <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all group-hover:ring-2 group-hover:ring-zinc-900 dark:group-hover:ring-zinc-50 shadow-sm group-hover:shadow-md relative">
        {series.cover_url && (
          <img
            src={series.cover_url}
            alt={series.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
          />
        )}
        {typeof index === 'number' && (
          <div className="absolute top-2 left-2 bg-zinc-900/90 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-lg">
            #{index + 1}
          </div>
        )}
        <Badge className="absolute top-2 right-2 capitalize text-[10px]" variant="secondary">
          {series.type}
        </Badge>
      </div>
      <div className="space-y-1 px-1">
        <h3 className="font-bold text-sm leading-tight truncate">{series.title}</h3>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-medium">
          <span className="flex items-center gap-1">
            <Star className="size-3 text-yellow-500 fill-yellow-500" /> {series.average_rating || "N/A"}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {series.total_follows >= 1000 ? `${Math.round(series.total_follows / 1000)}K` : series.total_follows}
          </span>
        </div>
      </div>
    </Link>
  )
}

  const DiscoverPageContent = () => {
  const searchParams = useSearchParams()
  
  const [query, setQuery] = useState(searchParams.get("q") || "")
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [results, setResults] = useState<Series[]>([])
  const [trending, setTrending] = useState<Series[]>([])
  const [popularManga, setPopularManga] = useState<Series[]>([])
  const [popularManhwa, setPopularManhwa] = useState<Series[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingTrending, setLoadingTrending] = useState(true)
  const [loadingPopular, setLoadingPopular] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const offsetRef = useRef(0)
  const observerTarget = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  
  const debouncedQuery = useDebounce(query, 300)

  const fetchTrending = useCallback(async () => {
    setLoadingTrending(true)
    try {
      const res = await fetch("/api/series/trending?limit=10")
      if (res.ok) {
        const data = await res.json()
        setTrending(data.results || data.series || [])
      }
    } catch (error) {
      console.error("Failed to fetch trending:", error)
    } finally {
      setLoadingTrending(false)
    }
  }, [])

  const fetchPopular = useCallback(async () => {
    setLoadingPopular(true)
    try {
      const [mangaRes, manhwaRes] = await Promise.all([
        fetch("/api/series/trending?type=manga&limit=6"),
        fetch("/api/series/trending?type=manhwa&limit=6"),
      ])
      
      if (mangaRes.ok) {
        const data = await mangaRes.json()
        setPopularManga(data.results || data.series || [])
      }
      if (manhwaRes.ok) {
        const data = await manhwaRes.json()
        setPopularManhwa(data.results || data.series || [])
      }
    } catch (error) {
      console.error("Failed to fetch popular:", error)
    } finally {
      setLoadingPopular(false)
    }
  }, [])

  const searchSeries = useCallback(async (reset = false) => {
    if (!debouncedQuery && selectedGenres.length === 0 && !selectedType) {
      setIsSearching(false)
      return
    }

    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    abortControllerRef.current = new AbortController()

    const currentOffset = reset ? 0 : offsetRef.current
    if (reset) {
      setLoading(true)
      setError(null)
      offsetRef.current = 0
    } else {
      setLoadingMore(true)
    }

    try {
      const params = new URLSearchParams()
      if (debouncedQuery) params.set("q", debouncedQuery)
      if (selectedGenres.length > 0) params.set("genres", selectedGenres.join(","))
      if (selectedType) params.set("type", selectedType)
      params.set("offset", currentOffset.toString())
      params.set("limit", "20")

      const res = await fetch(`/api/series/search?${params.toString()}`, {
        signal: abortControllerRef.current.signal,
      })
      
      if (res.ok) {
        const data = await res.json()
        const newResults = data.results || []
        
        if (reset) {
          setResults(newResults)
        } else {
          setResults((prev) => [...prev, ...newResults])
        }
        setHasMore(data.has_more || false)
        offsetRef.current = currentOffset + newResults.length
        setIsSearching(true)
      } else {
        setError("Failed to search. Please try again.")
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return // Request was cancelled, ignore
      }
      console.error("Failed to search:", error)
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [debouncedQuery, selectedGenres, selectedType])

  useEffect(() => {
    fetchTrending()
    fetchPopular()
  }, [fetchTrending, fetchPopular])

  // Auto-search when debounced query changes
  useEffect(() => {
    if (debouncedQuery || selectedGenres.length > 0 || selectedType) {
      searchSeries(true)
    }
  }, [debouncedQuery, selectedGenres, selectedType])

  useEffect(() => {
    if (!observerTarget.current || !isSearching || !hasMore || loadingMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          searchSeries(false)
        }
      },
      { threshold: 0.1 }
    )

    const target = observerTarget.current
    observer.observe(target)
    return () => {
      observer.unobserve(target)
      observer.disconnect()
    }
  }, [isSearching, hasMore, loadingMore, searchSeries])

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    searchSeries(true)
  }

  const toggleGenre = useCallback((genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    )
  }, [])

  const clearFilters = useCallback(() => {
    setQuery("")
    setSelectedGenres([])
    setSelectedType(null)
    setIsSearching(false)
    setResults([])
    setError(null)
    offsetRef.current = 0
  }, [])

  if (isSearching) {
    return (
      <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {query ? `Results for "${query}"` : "Filtered Results"}
            </h1>
            <p className="text-zinc-500">{results.length} series found</p>
          </div>
          <Button variant="outline" onClick={clearFilters} className="rounded-xl">
            <X className="size-4 mr-2" />
            Clear Filters
          </Button>
        </div>

        <form onSubmit={handleSearch} className="max-w-2xl relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for more..."
            className="h-14 pl-12 pr-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
          />
        </form>

        <div className="flex flex-wrap gap-2">
          {selectedGenres.map((genre) => (
            <Badge
              key={genre}
              className="cursor-pointer bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
              onClick={() => toggleGenre(genre)}
            >
              {genre} <X className="size-3 ml-1" />
            </Badge>
          ))}
          {selectedType && (
            <Badge
              className="cursor-pointer bg-zinc-900 text-zinc-50 hover:bg-zinc-800 capitalize"
              onClick={() => setSelectedType(null)}
            >
              {selectedType} <X className="size-3 ml-1" />
            </Badge>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
            <AlertCircle className="size-5 text-red-500" />
            <p className="text-red-600 dark:text-red-400">{error}</p>
            <Button variant="ghost" size="sm" onClick={() => searchSeries(true)} className="ml-auto">
              Retry
            </Button>
          </div>
        )}

        {loading ? (
          <SeriesSkeleton />
        ) : results.length > 0 ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
              {results.map((series) => (
                <SeriesCard key={series.id} series={series} />
              ))}
            </div>
            
            <div ref={observerTarget} className="flex justify-center py-8">
              {loadingMore && <Loader2 className="size-6 animate-spin text-zinc-400" />}
              {!hasMore && results.length > 0 && (
                <p className="text-zinc-500 text-sm">No more results</p>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
            <div className="size-20 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
              <Search className="size-10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">No series found</h3>
              <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
                Try a different search term or adjust your filters.
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 space-y-12 max-w-7xl mx-auto pb-24">
      <section className="relative h-[300px] rounded-3xl overflow-hidden bg-zinc-900 flex flex-col items-center justify-center text-center p-6 space-y-6">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1614728263952-84ea256f9679?q=80&w=1200&auto=format&fit=crop')] bg-cover bg-center opacity-30" />
        <div className="relative z-10 space-y-4">
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white">Find your next favorite.</h1>
          <p className="text-zinc-300 text-lg max-w-xl mx-auto">
            Browse thousands of manga, manhwa, and webtoons across all platforms.
          </p>
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto w-full relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-zinc-400" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, author, or genre..."
              className="h-14 pl-12 pr-4 rounded-2xl bg-white/10 backdrop-blur-xl border-white/20 text-white placeholder:text-zinc-400 text-lg"
            />
          </form>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Filter by Genre</h2>
        <div className="flex flex-wrap gap-2">
          {GENRES.map((genre) => (
            <Badge
              key={genre}
              variant={selectedGenres.includes(genre) ? "default" : "outline"}
              className={`cursor-pointer transition-all ${
                selectedGenres.includes(genre)
                  ? "bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
                  : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              onClick={() => toggleGenre(genre)}
            >
              {genre}
            </Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((type) => (
            <Badge
              key={type}
              variant={selectedType === type ? "default" : "outline"}
              className={`cursor-pointer capitalize transition-all ${
                selectedType === type
                  ? "bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
                  : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              }`}
              onClick={() => setSelectedType(selectedType === type ? null : type)}
            >
              {type}
            </Badge>
          ))}
        </div>
      </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Flame className="size-5 text-orange-500" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Trending This Week</h2>
            </div>
          </div>
          {loadingTrending ? (
            <SeriesSkeleton />
          ) : trending.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
              {trending.map((series, index) => (
                <SeriesCard key={series.id} series={series} index={index} />
              ))}
            </div>
          ) : (
            <div className="py-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500 text-sm">No trending series found this week.</p>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <BookOpen className="size-5 text-blue-500" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Popular Manga</h2>
            </div>
          </div>
          {loadingPopular ? (
            <div className="grid grid-cols-6 gap-6">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
              ))}
            </div>
          ) : popularManga.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
              {popularManga.map((series) => (
                <Link key={series.id} href={`/series/${series.id}`} className="group space-y-2">
                  <div className="aspect-[3/4] overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative">
                    {series.cover_url && (
                      <img
                        src={series.cover_url}
                        alt={series.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    )}
                    <Badge
                      className={`absolute bottom-2 right-2 text-[10px] ${
                        series.status === "ongoing" ? "bg-green-500" : "bg-blue-500"
                      }`}
                    >
                      {series.status}
                    </Badge>
                  </div>
                  <h3 className="font-bold text-xs leading-tight truncate px-1">{series.title}</h3>
                </Link>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500 text-xs">No popular manga found.</p>
            </div>
          )}
        </section>

        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <TrendingUp className="size-5 text-purple-500" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Popular Manhwa</h2>
            </div>
          </div>
          {loadingPopular ? (
            <div className="grid grid-cols-6 gap-6">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
              ))}
            </div>
          ) : popularManhwa.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
              {popularManhwa.map((series) => (
                <Link key={series.id} href={`/series/${series.id}`} className="group space-y-2">
                  <div className="aspect-[3/4] overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 relative">
                    {series.cover_url && (
                      <img
                        src={series.cover_url}
                        alt={series.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform group-hover:scale-105"
                      />
                    )}
                    <Badge
                      className={`absolute bottom-2 right-2 text-[10px] ${
                        series.status === "ongoing" ? "bg-green-500" : "bg-blue-500"
                      }`}
                    >
                      {series.status}
                    </Badge>
                  </div>
                  <h3 className="font-bold text-xs leading-tight truncate px-1">{series.title}</h3>
                </Link>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500 text-xs">No popular manhwa found.</p>
            </div>
          )}
        </section>


      <section className="bg-gradient-to-r from-zinc-900 to-zinc-800 rounded-3xl p-8 md:p-12 text-white">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">Can&apos;t find what you&apos;re looking for?</h2>
          <p className="text-zinc-300 mb-6">
            We&apos;re constantly adding new series. Request a title and we&apos;ll add it to our database.
          </p>
          <Button className="bg-white text-zinc-900 hover:bg-zinc-100 rounded-full px-8">Request a Series</Button>
        </div>
      </section>
    </div>
  )
}

function DiscoverPageSkeleton() {
  return (
    <div className="p-6 space-y-12 max-w-7xl mx-auto pb-24">
      <Skeleton className="h-[300px] rounded-3xl" />
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="flex flex-wrap gap-2">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-full" />
          ))}
        </div>
      </div>
      <SeriesSkeleton />
    </div>
  )
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<DiscoverPageSkeleton />}>
      <DiscoverPageContent />
    </Suspense>
  )
}
