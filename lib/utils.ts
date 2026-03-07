import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Parse fetch response as JSON; if body is plain text (e.g. error page), return fallback and surface message */
export async function safeResJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return (text ? JSON.parse(text) : {}) as T
  } catch {
    throw new Error(text?.slice(0, 200) || `Request failed (${res.status})`)
  }
}
