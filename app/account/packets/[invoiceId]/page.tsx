import Link from "next/link"
import { notFound, redirect } from "next/navigation"

import { getSession } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ invoiceId: string }>
  searchParams?: Promise<{ checkout?: string }>
}

export default async function PacketDetailPage({ params, searchParams }: Props) {
  const session = await getSession()
  if (!session?.user) redirect("/auth/signin")

  const { invoiceId } = await params
  const sp = (await searchParams) ?? {}

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      userId: true,
      invoiceNumber: true,
      invoiceType: true,
      status: true,
      paidAt: true,
      packetStatus: true,
      packetPdfUrl: true,
      packetGeneratedAt: true,
      packetDeliveredAt: true,
      packetLastError: true,
      createdAt: true,
    },
  })
  if (!invoice) notFound()

  const role = (session.user as { role?: string }).role
  const isAdmin = role === "ADMIN"
  const isOwner = invoice.userId === session.user.id
  if (!isOwner && !isAdmin) notFound()

  if (invoice.invoiceType !== "COMPS_ONLY") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle>Invoice {invoice.invoiceNumber}</CardTitle>
            <CardDescription>This invoice does not have a packet attached.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const justPaid = sp.checkout === "diy_success"
  const stage = invoice.packetStatus

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <nav className="mb-4">
        <Link href="/account" className="text-sm text-blue-700 hover:text-blue-900 underline">← Back to account</Link>
      </nav>

      {justPaid && (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          ✓ Payment received. Your packet is being generated — usually done within a minute.
        </div>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Appeal Packet</CardTitle>
          <CardDescription>Invoice {invoice.invoiceNumber}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <StageBlock stage={stage} invoiceId={invoice.id} pdfReady={Boolean(invoice.packetPdfUrl)} />

          <dl className="grid grid-cols-2 gap-2 text-sm pt-4 border-t border-gray-100">
            <dt className="text-gray-500">Payment</dt>
            <dd className="text-gray-900">{invoice.status}{invoice.paidAt ? ` · ${new Date(invoice.paidAt).toLocaleDateString()}` : ""}</dd>
            <dt className="text-gray-500">Packet status</dt>
            <dd className="text-gray-900">{stage}</dd>
            {invoice.packetGeneratedAt && (
              <>
                <dt className="text-gray-500">Generated</dt>
                <dd className="text-gray-900">{new Date(invoice.packetGeneratedAt).toLocaleString()}</dd>
              </>
            )}
            {invoice.packetDeliveredAt && (
              <>
                <dt className="text-gray-500">Emailed</dt>
                <dd className="text-gray-900">{new Date(invoice.packetDeliveredAt).toLocaleString()}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      <p className="text-xs text-gray-500 text-center">
        Questions? Email{" "}
        <a className="underline" href={`mailto:support@overtaxed-il.com?subject=Packet ${invoice.invoiceNumber}`}>
          support@overtaxed-il.com
        </a>
        {" "}· Reference {invoice.invoiceNumber}
      </p>
    </div>
  )
}

function StageBlock({ stage, invoiceId, pdfReady }: { stage: string; invoiceId: string; pdfReady: boolean }) {
  if (stage === "NOT_STARTED") {
    return <p className="text-sm text-gray-700">Your payment is being processed. This page will update once the packet is ready.</p>
  }
  if (stage === "GENERATING") {
    return (
      <div className="text-sm text-gray-700">
        <p>We&apos;re building your personalized appeal packet right now.</p>
        <p className="text-gray-500 text-xs mt-2">Refresh this page in about a minute.</p>
      </div>
    )
  }
  if ((stage === "READY" || stage === "DELIVERED") && pdfReady) {
    return (
      <a
        href={`/api/account/packets/${invoiceId}/download`}
        className="inline-block bg-blue-700 hover:bg-blue-800 text-white font-semibold text-sm px-5 py-3 rounded-lg"
      >
        📄 Download appeal packet PDF
      </a>
    )
  }
  if (stage === "MANUAL_REVIEW") {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-semibold">We need to review your packet manually.</p>
        <p className="mt-1">
          Our team was alerted the moment this happened and will reach out personally within one business day. You do not need to do anything.
        </p>
      </div>
    )
  }
  if (stage === "FAILED") {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
        <p className="font-semibold">Something went wrong generating your packet.</p>
        <p className="mt-1">Support has been notified and will follow up. No charges have been lost.</p>
      </div>
    )
  }
  return <p className="text-sm text-gray-700">Status: {stage}</p>
}
