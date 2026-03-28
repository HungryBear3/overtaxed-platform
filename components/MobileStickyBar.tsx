import Link from "next/link"

type Props = {
  href: string
  label: string
  subtext?: string
  color?: 'green' | 'amber'
}

export function MobileStickyBar({ href, label, subtext, color = 'amber' }: Props) {
  const btnClass =
    color === 'amber'
      ? 'bg-amber-500 hover:bg-amber-600 text-white'
      : 'bg-green-600 hover:bg-green-700 text-white'

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-200 px-4 py-3 shadow-lg">
      <Link
        href={href}
        className={`block w-full text-center font-semibold py-3 rounded-lg transition-colors ${btnClass}`}
      >
        {label}
      </Link>
      {subtext && (
        <p className="text-center text-xs text-gray-500 mt-1">{subtext}</p>
      )}
    </div>
  )
}
