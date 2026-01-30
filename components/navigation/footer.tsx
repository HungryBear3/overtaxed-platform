"use client"

import Link from "next/link"

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/properties", label: "Properties" },
  { href: "/appeals", label: "Appeals" },
  { href: "/pricing", label: "Pricing" },
  { href: "/account", label: "Account" },
]

export function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <p className="text-sm text-gray-500">
            © {new Date().getFullYear()} OverTaxed. Illinois property tax appeals.
          </p>
          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
            {links.map(({ href, label }) => (
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
    </footer>
  )
}
