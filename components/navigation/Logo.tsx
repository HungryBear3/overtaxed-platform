import Link from "next/link"
import Image from "next/image"

type LogoProps = {
  href?: string
  className?: string
  size?: "sm" | "md"
}

const sizes = {
  sm: { width: 120, height: 24 },
  md: { width: 170, height: 34 },
}

export function Logo({ href = "/", className = "h-8 w-auto", size = "md" }: LogoProps) {
  const { width, height } = sizes[size]
  const img = (
    <Image
      src="/logo.svg"
      alt="OverTaxed IL"
      width={width}
      height={height}
      className={className}
      priority={size === "md"}
    />
  )
  return href ? (
    <Link href={href} className="flex items-center">
      {img}
    </Link>
  ) : (
    img
  )
}
