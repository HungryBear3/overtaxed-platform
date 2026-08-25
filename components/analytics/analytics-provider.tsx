"use client"

import { Suspense } from "react"
import { AnalyticsRouteTracker } from "./analytics-route-tracker"

interface AnalyticsProviderProps {
  children?: React.ReactNode
}

/**
 * Analytics Provider: GA4, Meta Pixel, UTM capture, page view tracking.
 *
 * The effects themselves live in `AnalyticsRouteTracker`, which renders no
 * route content. This wrapper keeps the historical shape — a provider that
 * takes `children` — for callers and tests that mount it directly.
 */
export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  return (
    <>
      <AnalyticsRouteTracker />
      {children}
    </>
  )
}

/**
 * Root-layout mount: a narrow `<Suspense>` around the tracker, with route
 * children as its *sibling*.
 *
 * The tracker reads `useSearchParams()`, which cannot be prerendered — Next
 * hands the enclosing Suspense boundary to the client and serves
 * `<template data-dgst="BAILOUT_TO_CLIENT_SIDE_RENDERING">` in its place. While
 * `children` sat inside this boundary that bailout was the whole page: `/`,
 * `/pricing` and `/terms` served an empty `<body>`, no `<h1>`, and only became
 * readable after hydration.
 *
 * Keeping `{children}` outside the boundary confines the bailout to a component
 * that renders nothing on the server anyway. Analytics behavior is unchanged —
 * the tracker mounts on the same client render it always did.
 */
export function AnalyticsProviderWithSuspense({ children }: AnalyticsProviderProps) {
  return (
    <>
      <Suspense fallback={null}>
        <AnalyticsRouteTracker />
      </Suspense>
      {children}
    </>
  )
}
