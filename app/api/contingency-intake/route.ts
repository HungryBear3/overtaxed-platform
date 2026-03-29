import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Resend } from "resend";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      fullName,
      email,
      phone,
      propertyPin,
      propertyAddress,
      estimatedAssessedValue,
      hearAboutUs,
    } = body;

    if (!fullName || !email || !phone || !propertyPin || !propertyAddress) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const resend = new Resend(process.env.OT_RESEND_API_KEY);

    // Save to DB
    await prisma.contingencyLead.create({
      data: {
        fullName,
        email,
        phone,
        propertyPin,
        propertyAddress,
        estimatedAssessedValue: estimatedAssessedValue || null,
        hearAboutUs: hearAboutUs || null,
      },
    });

    // Send confirmation email
    await resend.emails.send({
      from: "Overtaxed IL <hello@overtaxed-il.com>",
      to: email,
      subject: "We received your property appeal request",
      html: `
        <p>Hi ${fullName},</p>
        <p>Thanks for reaching out! We received your request for a free property tax assessment for:</p>
        <p><strong>${propertyAddress}</strong> (PIN: ${propertyPin})</p>
        <p>We'll review your property and be in touch within <strong>2 business days</strong>.</p>
        <p>Questions? Reply to this email anytime.</p>
        <p>— The Overtaxed IL Team</p>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[contingency-intake]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
