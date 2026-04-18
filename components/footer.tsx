import Link from "next/link"
import { Logo } from "@/components/navigation/Logo"

export function Footer() {
  return (
    <footer className="py-12 bg-background border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="md:col-span-2">
            <div className="mb-4">
              <Logo href="/" size="sm" />
            </div>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Helping Cook County homeowners understand their property assessments and file effective appeals.
              We specialize in making the appeal process clear, affordable, and accessible.
            </p>
            <p className="text-xs text-muted-foreground">
              OverTaxed IL is not a law firm and does not provide legal advice.
            </p>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Quick Links</h4>
            <ul className="space-y-2">
              <li>
                <Link href="#how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link href="#options" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Appeal Options
                </Link>
              </li>
              <li>
                <Link href="#faq" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/check" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  Free Property Check
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-foreground mb-4">Contact</h4>
            <ul className="space-y-2">
              <li>
                <a href="mailto:hello@overtaxedil.com" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                  hello@overtaxedil.com
                </a>
              </li>
              <li className="text-sm text-muted-foreground">
                Cook County, Illinois
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-border flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} OverTaxed IL. All rights reserved.
          </p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Privacy Policy
            </Link>
            <Link href="/terms" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
