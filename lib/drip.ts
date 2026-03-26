import { prisma } from "@/lib/db/prisma"

const SEQUENCES: Record<string, number[]> = {
  "ot-township": [0, 3, 7, 14, 30],
}

export async function enrollInDrip(email: string, sequence: string): Promise<void> {
  const delays = SEQUENCES[sequence]
  if (!delays) {
    console.warn(`[drip] Unknown sequence: ${sequence}`)
    return
  }

  // Skip if already enrolled
  const existing = await prisma.dripEmail.findFirst({
    where: { email, sequence },
  })
  if (existing) return

  const now = new Date()
  await prisma.dripEmail.createMany({
    data: delays.map((days, i) => ({
      email,
      sequence,
      step: i + 1,
      scheduledFor: new Date(now.getTime() + days * 24 * 60 * 60 * 1000),
    })),
  })
}
