"use client"

import { useEffect, useState } from "react"
import { Users } from "lucide-react"

interface VisitorCounterProps {
  className?: string
  showToday?: boolean
}

export function VisitorCounter({ className = "", showToday = false }: VisitorCounterProps) {
  const [count, setCount] = useState<number | null>(null)
  const [todayCount, setTodayCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const run = async () => {
      try {
        const sessionKey = "visitor_tracked"
        const hasTracked = typeof window !== "undefined" ? sessionStorage.getItem(sessionKey) : null

        if (!hasTracked) {
          const postRes = await fetch("/api/visitors", { method: "POST" })
          if (postRes.ok) {
            const data = await postRes.json()
            setCount(data.total ?? 0)
            setTodayCount(data.today ?? 0)
            sessionStorage.setItem(sessionKey, "true")
          } else {
            const getRes = await fetch("/api/visitors")
            if (getRes.ok) {
              const data = await getRes.json()
              setCount(data.total ?? 0)
              setTodayCount(data.today ?? 0)
            }
          }
        } else {
          const getRes = await fetch("/api/visitors")
          if (getRes.ok) {
            const data = await getRes.json()
            setCount(data.total ?? 0)
            setTodayCount(data.today ?? 0)
          }
        }
      } catch {
        setCount(0)
        setTodayCount(0)
      } finally {
        setLoading(false)
      }
    }

    run()
  }, [])

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Users className="h-4 w-4 text-gray-400 animate-pulse" />
        <span className="text-sm text-gray-500">Loading...</span>
      </div>
    )
  }

  const displayCount = count ?? 0
  const displayToday = todayCount ?? 0

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Users className="h-4 w-4 text-blue-600" />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-900">
          {displayCount.toLocaleString()} {displayCount === 1 ? "visitor" : "visitors"}
        </span>
        {showToday && (
          <span className="text-xs text-gray-500">
            {displayToday.toLocaleString()} today
          </span>
        )}
      </div>
    </div>
  )
}
