"use client";

import { useMemo, useState } from "react";
import type { ElementType } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileText,
  Mail,
  MessageSquareText,
  PauseCircle,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import type { OutreachApprovalData, OutreachApprovalStatus } from "@/lib/outreach/approval-queue";

const statusConfig: Record<OutreachApprovalStatus, { label: string; short: string; tone: string; icon: ElementType }> = {
  needs_review: { label: "Needs review", short: "Draft · not sent", tone: "border-amber-200 bg-amber-50 text-amber-900", icon: FileText },
  approved_no_send: { label: "Approved — not sent", short: "Approved · no send", tone: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2 },
  sent_monitoring: { label: "Sent · monitoring", short: "Monitoring", tone: "border-blue-200 bg-blue-50 text-blue-900", icon: Mail },
  blocked: { label: "Blocked — won’t send", short: "Blocked", tone: "border-red-200 bg-red-50 text-red-900", icon: AlertTriangle },
  bounced: { label: "Bounced — never inboxed", short: "Bounced", tone: "border-zinc-300 bg-zinc-100 text-zinc-800", icon: XCircle },
  reply: { label: "Replies", short: "Reply", tone: "border-purple-200 bg-purple-50 text-purple-900", icon: MessageSquareText },
};

const filterOrder: Array<{ id: OutreachApprovalStatus | "all"; label: string }> = [
  { id: "needs_review", label: "Needs your review" },
  { id: "approved_no_send", label: "Approved — not sent" },
  { id: "sent_monitoring", label: "Sent · monitoring" },
  { id: "blocked", label: "Blocked — won’t send" },
  { id: "bounced", label: "Bounced — never inboxed" },
  { id: "reply", label: "Replies" },
  { id: "all", label: "All packets" },
];

const safetyChecks = [
  "Read-only screen: no network sender attached",
  "Approval creates no outbound email",
  "No exact savings promises in selected draft",
  "Not a law firm / not legal advice boundary present",
  "Opt-out and blocked states are non-green",
  "Manual send step separated from review approval",
];

type OutreachApprovalConsoleProps = {
  data: OutreachApprovalData
}

export function OutreachApprovalConsole({ data }: OutreachApprovalConsoleProps) {
  const packets = data.packets;
  const initialFilter: OutreachApprovalStatus | "all" = data.counts.needs_review > 0 ? "needs_review" : "all";
  const [filter, setFilter] = useState<OutreachApprovalStatus | "all">(initialFilter);
  const [selectedId, setSelectedId] = useState(packets[0]?.id ?? "");
  const [showConfirm, setShowConfirm] = useState(false);
  const [reviewLog, setReviewLog] = useState<string[]>([]);

  const visiblePackets = useMemo(
    () => packets.filter((packet) => filter === "all" || packet.status === filter),
    [filter],
  );
  const selected = packets.find((packet) => packet.id === selectedId) ?? packets[0] ?? null;
  const SelectedIcon = selected ? statusConfig[selected.status].icon : FileText;

  function handleMockAction(action: string) {
    const stamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setReviewLog((items) => [`${stamp} · Local review note only: ${action} on ${selected.id}. No email sent.`, ...items].slice(0, 5));
    setShowConfirm(false);
  }

  if (!selected) {
    return (
      <div className="min-h-screen bg-[#f6f1e8] text-zinc-950">
        <div className="border-b border-red-200 bg-red-950 px-4 py-3 text-red-50">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.18em]">
              <ShieldCheck className="h-4 w-4" /> Live database · review-only · no sending
            </div>
            <div className="text-red-100">No outreach API or sender is called from this screen.</div>
          </div>
        </div>
        <main className="mx-auto max-w-4xl px-4 py-10">
          <Link href="/" className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">OverTaxed IL internal</Link>
          <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Outreach approval queue</h1>
          <div className="mt-6 rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Database connected</div>
            <p className="mt-2 text-zinc-700">No outreach prospects, sends, replies, or suppressions are available for review yet. Mock data has been removed.</p>
            <p className="mt-3 text-sm text-zinc-500">Generated {new Date(data.generatedAt).toLocaleString()}.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f1e8] text-zinc-950">
      <div className="border-b border-red-200 bg-red-950 px-4 py-3 text-red-50">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 font-semibold uppercase tracking-[0.18em]">
            <ShieldCheck className="h-4 w-4" /> Live database · review-only · no sending
          </div>
          <div className="text-red-100">
            Real outreach records are loaded read-only. Buttons write local review notes in this browser; no outreach API or sender is called.
          </div>
        </div>
      </div>

      <header className="border-b border-zinc-200 bg-white/85 px-4 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Link href="/" className="text-sm font-semibold uppercase tracking-[0.24em] text-zinc-500">
              OverTaxed IL internal
            </Link>
            <h1 className="mt-1 text-3xl font-black tracking-[-0.04em] md:text-5xl">Outreach approval queue</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-600 md:text-base">
              Business-first review surface for HOA/resource outreach. Approval here is a review decision only; a separate manual sender would be required later.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric label="drafts" value={data.counts.needs_review} />
            <Metric label="sent/monitoring" value={data.counts.sent_monitoring} />
            <Metric label="blocked" value={data.counts.blocked + data.counts.bounced} />
            <Metric label="replies" value={data.counts.reply} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-5 lg:grid-cols-[260px_minmax(320px,420px)_1fr]">
        <aside className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Queues</div>
          <div className="space-y-2">
            {filterOrder.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`flex min-h-11 w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition ${
                    active ? "bg-zinc-950 text-white" : "bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <span>{item.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-white/15" : "bg-white"}`}>{data.counts[item.id]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Sender state</div>
            <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-red-800">
              <PauseCircle className="h-4 w-4" /> Disabled on this screen
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-600">
              This page reads outreach records from the database. It does not expose a sender, retry, or webhook action.
            </p>
          </div>
        </aside>

        <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Next best action</div>
              <h2 className="mt-1 text-2xl font-black tracking-[-0.03em]">{visiblePackets.length} packet{visiblePackets.length === 1 ? "" : "s"}</h2>
            </div>
            <div className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">ordered by risk</div>
          </div>

          <div className="mt-4 space-y-3">
            {visiblePackets.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
                No real outreach records in this queue. Data source is the outreach database; no demo packets are shown.
              </div>
            ) : null}
            {visiblePackets.map((packet) => {
              const cfg = statusConfig[packet.status];
              const active = packet.id === selected.id;
              const Icon = cfg.icon;
              return (
                <button
                  key={packet.id}
                  type="button"
                  onClick={() => setSelectedId(packet.id)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${
                    active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-zinc-50 text-zinc-900 hover:border-zinc-400"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-[0.18em] opacity-60">{packet.id}</div>
                      <div className="mt-1 font-bold">{packet.organization}</div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${active ? "border-white/20 bg-white/10 text-white" : cfg.tone}`}>
                      <Icon className="h-3.5 w-3.5" /> {cfg.short}
                    </span>
                  </div>
                  <p className={`mt-3 text-sm leading-5 ${active ? "text-zinc-200" : "text-zinc-600"}`}>{packet.summary}</p>
                  <div className={`mt-3 grid grid-cols-2 gap-2 text-xs ${active ? "text-zinc-300" : "text-zinc-500"}`}>
                    <span>{packet.township}</span>
                    <span>{packet.units} units</span>
                    <span>{packet.draftedBy}</span>
                    <span>{packet.updated}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">{selected.id} · {selected.channel}</div>
                <h2 className="mt-1 text-3xl font-black tracking-[-0.04em]">{selected.organization}</h2>
                <p className="mt-2 text-sm text-zinc-600">
                  {selected.township} township · {selected.units} units · {selected.contact} ({selected.role})
                </p>
              </div>
              <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-2 text-sm font-bold ${statusConfig[selected.status].tone}`}>
                <SelectedIcon className="h-4 w-4" /> {statusConfig[selected.status].label}
              </span>
            </div>

            <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-950">
              <div className="font-bold uppercase tracking-[0.14em]">No outbound action available</div>
              <p className="mt-1">This route can only simulate review outcomes. It cannot send, resend, retry, or bypass blocked contacts.</p>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(true)}
                disabled={selected.status === "blocked" || selected.status === "bounced" || selected.status === "reply"}
                className="min-h-11 rounded-full bg-zinc-950 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600"
              >
                Approve draft — no send
              </button>
              <button type="button" onClick={() => handleMockAction("requested edit from Rex")} className="min-h-11 rounded-full border border-zinc-300 px-5 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50">
                Request edit from Rex
              </button>
              <button type="button" onClick={() => handleMockAction("held for later")} className="min-h-11 rounded-full border border-zinc-300 px-5 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50">
                Hold for later
              </button>
              <button type="button" onClick={() => handleMockAction("declined send")} className="min-h-11 rounded-full border border-red-300 px-5 py-2 text-sm font-bold text-red-800 hover:bg-red-50">
                Decline — don’t send
              </button>
            </div>
            <p className="mt-2 text-xs font-medium text-zinc-500">Action labels intentionally say “no send.” Approval is separate from any future manual sender.</p>
          </div>

          <div className="grid gap-0 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="border-b border-zinc-200 p-5 xl:border-b-0 xl:border-r">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Draft/email record preview — no send controls</div>
              <h3 className="mt-1 text-xl font-black tracking-[-0.02em]">{selected.subject}</h3>
              <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                {selected.body.map((paragraph, index) => (
                  <p key={`${selected.id}-${index}`} className="mb-3 last:mb-0 text-sm leading-6 text-zinc-700">
                    {paragraph}
                  </p>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                <div className="font-bold">Claim posture</div>
                <p className="mt-1">{selected.ownerCountNote}</p>
              </div>
              {selected.replySnippet ? (
                <div className="mt-4 rounded-2xl border border-purple-200 bg-purple-50 p-4 text-sm text-purple-950">
                  <div className="font-bold">Incoming reply</div>
                  <p className="mt-1">“{selected.replySnippet}”</p>
                </div>
              ) : null}
            </div>

            <div className="p-5">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">Pre-send safety checks</div>
              <ul className="mt-3 space-y-2">
                {safetyChecks.map((check) => (
                  <li key={check} className="flex gap-2 text-sm text-zinc-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                    <span>{check}</span>
                  </li>
                ))}
              </ul>

              {selected.blockers?.length ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 p-4">
                  <div className="flex items-center gap-2 text-sm font-bold text-red-950">
                    <AlertTriangle className="h-4 w-4" /> Blockers
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-red-900">
                    {selected.blockers.map((blocker) => (
                      <li key={blocker}>• {blocker}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-zinc-900">
                  <Clock3 className="h-4 w-4" /> Local review notes
                </div>
                <ul className="mt-3 space-y-2 text-sm text-zinc-600">
                  <li>Today 9:42 · {selected.draftedBy} created draft from HOA resource template.</li>
                  <li>Today 9:45 · Copy safety pass removed guarantee/savings language.</li>
                  <li>Today 9:46 · Sender disabled; awaiting human review.</li>
                  {reviewLog.map((item) => (
                    <li key={item} className="font-semibold text-zinc-900">{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </main>

      <section className="mx-auto max-w-7xl px-4 pb-8">
        <div className="rounded-3xl border border-zinc-200 bg-zinc-950 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-400">Compact/mobile behavior</div>
              <p className="mt-1 text-sm text-zinc-200">Cards stack, buttons wrap to full-width-safe hit targets, and the no-send database warning stays above the queue.</p>
            </div>
            <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
              No mobile-only sender controls <ArrowRight className="h-4 w-4" /> same local review actions only
            </div>
          </div>
        </div>
      </section>

      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="review-confirm-title">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-2 text-red-800">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-[0.18em]">Review confirmation</span>
            </div>
            <h2 id="review-confirm-title" className="mt-3 text-2xl font-black tracking-[-0.03em]">Approve draft without sending?</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              This records a local review note in this browser only. It does not call an API, create an email, or contact {selected.organization}.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => handleMockAction("approved draft without sending")} className="min-h-11 rounded-full bg-zinc-950 px-5 py-2 text-sm font-bold text-white">
                Confirm local note
              </button>
              <button type="button" onClick={() => setShowConfirm(false)} className="min-h-11 rounded-full border border-zinc-300 px-5 py-2 text-sm font-bold text-zinc-800">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-center">
      <div className="text-2xl font-black tracking-[-0.04em] text-zinc-950">{value}</div>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</div>
    </div>
  );
}
