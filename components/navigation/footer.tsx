"use client"

import Link from "next/link"
import { VisitorCounter } from "@/components/visitor-counter"

const appLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/appeals", label: "Appeals" },
  { href: "/pricing", label: "Pricing" },
  { href: "/account", label: "Account" },
]

const supportLinks = [
  { href: "/contact", label: "Contact" },
  { href: "/faq", label: "FAQ" },
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/disclaimer", label: "Disclaimer" },
]

export function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <p className="text-sm text-gray-500">
                © {new Date().getFullYear()} OverTaxed. Illinois property tax appeals.
              </p>
              <VisitorCounter showToday className="text-sm" />
            </div>
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
              {appLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm text-gray-500 hover:text-gray-900"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex justify-center border-t border-gray-100 pt-4">
            <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
              {supportLinks.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="text-sm text-gray-500 hover:text-gray-900"
                >
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </footer>
  )
}
