-- CreateTable
CREATE TABLE "FilingAuthorization" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "propertyAddress" TEXT NOT NULL,
    "propertyCity" TEXT NOT NULL,
    "propertyState" TEXT NOT NULL DEFAULT 'IL',
    "propertyZip" TEXT NOT NULL,
    "propertyPin" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "ownerEmail" TEXT NOT NULL,
    "ownerPhone" TEXT,
    "ownerAddress" TEXT NOT NULL,
    "ownerCity" TEXT NOT NULL,
    "ownerState" TEXT NOT NULL DEFAULT 'IL',
    "ownerZip" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilingAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilingAuthorization_appealId_key" ON "FilingAuthorization"("appealId");

-- CreateIndex
CREATE INDEX "FilingAuthorization_appealId_idx" ON "FilingAuthorization"("appealId");

-- AddForeignKey
ALTER TABLE "FilingAuthorization" ADD CONSTRAINT "FilingAuthorization_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
