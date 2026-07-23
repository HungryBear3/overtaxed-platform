import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  EMAIL_CONSENT_VERSION,
  FOLLOWUP_SOURCE,
  SMS_CONSENT_VERSION,
  normalizeEmail,
  normalizeUsPhone,
} from "@/lib/followups/config";
import { buildFollowupSchedule } from "@/lib/followups/schedule";
import { hostFromRequest, isPreviewStubEnabled, marketingGateReason, previewNoopResponseBody } from "@/lib/marketing/preview-gate";

export async function POST(req: NextRequest) {
  const host = hostFromRequest(req);
  if (isPreviewStubEnabled({ host })) {
    return NextResponse.json(previewNoopResponseBody(marketingGateReason({ host })));
  }

  const body = await req.json().catch(() => ({}));
  if (body.emailConsent !== true) {
    return NextResponse.json({ error: "Email consent is required to enroll." }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const smsConsented = body.smsConsent === true;
  const phone = smsConsented ? normalizeUsPhone(body.phone) : null;
  if (smsConsented && !phone) {
    return NextResponse.json({ error: "Enter a valid U.S. mobile number for text reminders." }, { status: 400 });
  }

  const now = new Date();
  const township = typeof body.township === "string" ? body.township.trim().slice(0, 80) : null;
  const propertyAddress = typeof body.propertyAddress === "string" ? body.propertyAddress.trim().slice(0, 240) : null;
  const potentialSavings = typeof body.potentialSavings === "number" && Number.isFinite(body.potentialSavings)
    ? Math.max(0, body.potentialSavings)
    : null;

  const subscriber = await prisma.freeCheckFollowupSubscriber.upsert({
    where: {
      emailNormalized_emailConsentVersion: {
        emailNormalized: email,
        emailConsentVersion: EMAIL_CONSENT_VERSION,
      },
    },
    create: {
      email,
      emailNormalized: email,
      emailConsentAt: now,
      emailConsentSource: FOLLOWUP_SOURCE,
      emailConsentVersion: EMAIL_CONSENT_VERSION,
      phoneE164: phone,
      smsConsentAt: smsConsented ? now : null,
      smsConsentSource: smsConsented ? FOLLOWUP_SOURCE : null,
      smsConsentVersion: smsConsented ? SMS_CONSENT_VERSION : null,
      township,
      propertyAddress,
      potentialSavings,
      resultUrl: "/#hero-check",
    },
    update: {
      township,
      propertyAddress,
      potentialSavings,
      ...(smsConsented && phone
        ? {
            phoneE164: phone,
            smsConsentAt: now,
            smsConsentSource: FOLLOWUP_SOURCE,
            smsConsentVersion: SMS_CONSENT_VERSION,
          }
        : {}),
    },
  });

  // An unsubscribe is durable. A later form submission does not silently
  // restore email or SMS consent; support can resolve an intentional re-opt-in.
  if (subscriber.emailSuppressedAt) {
    return NextResponse.json({ ok: true, status: "suppressed" });
  }

  const steps = buildFollowupSchedule({
    subscriberId: subscriber.id,
    township,
    smsConsented: Boolean(subscriber.smsConsentAt && subscriber.phoneE164 && !subscriber.smsSuppressedAt),
    now,
  });
  await prisma.freeCheckFollowupMessage.createMany({
    data: steps.map((step) => ({
      subscriberId: subscriber.id,
      step: step.step,
      channel: step.channel,
      idempotencyKey: step.idempotencyKey,
      scheduledFor: step.scheduledFor,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ ok: true, status: "enrolled", sms: Boolean(subscriber.smsConsentAt) });
}
