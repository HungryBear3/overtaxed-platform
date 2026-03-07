import Link from "next/link"
import { Settings, ArrowLeft } from "lucide-react"
import { SystemConfigClient } from "./SystemConfigClient"

export default function AdminSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/admin"
        className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <Settings className="h-6 w-6" />
        System Settings
      </h1>
      <p className="text-gray-600 mb-8">
        Configure rep code and business email for staff-assisted filing. See docs/REP_CODE_SETUP.md for how to obtain a rep code from Cook County Board of Review.
      </p>
      <SystemConfigClient />
    </div>
  )
}
