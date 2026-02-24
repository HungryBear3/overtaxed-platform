-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('OWNER', 'AUTHORIZED');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('COMPS_ONLY', 'STARTER', 'GROWTH', 'PORTFOLIO', 'PERFORMANCE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('INACTIVE', 'ACTIVE', 'CANCELLED', 'EXPIRED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "PerformancePaymentOption" AS ENUM ('UPFRONT', 'INSTALLMENTS');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('DRAFT', 'PENDING_FILING', 'FILED', 'UNDER_REVIEW', 'HEARING_SCHEDULED', 'DECISION_PENDING', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AppealType" AS ENUM ('ASSESSOR', 'BOARD_REVIEW', 'CERTIFICATE_ERROR');

-- CreateEnum
CREATE TYPE "FilingMethod" AS ENUM ('ELECTRONIC', 'PAPER', 'EMAIL');

-- CreateEnum
CREATE TYPE "AppealOutcome" AS ENUM ('WON', 'PARTIALLY_WON', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CompType" AS ENUM ('SALES', 'EQUITY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('APPEAL_FORM', 'COMP_PACKET', 'EVIDENCE_BRIEF', 'PHOTO', 'SUPPORTING_DOCUMENT', 'DECISION_LETTER', 'HEARING_NOTICE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SUBSCRIPTION', 'PERFORMANCE_FEE', 'COMPS_ONLY', 'LATE_FEE', 'COLLECTION_FEE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "MonitoringJobType" AS ENUM ('ASSESSMENT_CHECK', 'APPEAL_FILING', 'COMP_GENERATION', 'DEADLINE_REMINDER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" TEXT,
    "name" TEXT,
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "relationshipAttestation" "RelationshipType" NOT NULL DEFAULT 'OWNER',
    "attestationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'COMPS_ONLY',
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'INACTIVE',
    "subscriptionStartDate" TIMESTAMP(3),
    "subscriptionEndDate" TIMESTAMP(3),
    "subscriptionAnniversaryDate" TIMESTAMP(3),
    "subscriptionQuantity" INTEGER,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "performancePlanStartDate" TIMESTAMP(3),
    "performancePlanPaymentOption" "PerformancePaymentOption",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TermsAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "termsOfServiceAccepted" BOOLEAN NOT NULL DEFAULT false,
    "userAgreementAccepted" BOOLEAN NOT NULL DEFAULT false,
    "relationshipAttestation" BOOLEAN NOT NULL DEFAULT false,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "unitNumber" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IL',
    "zipCode" TEXT NOT NULL,
    "county" TEXT NOT NULL DEFAULT 'Cook',
    "neighborhood" TEXT,
    "subdivision" TEXT,
    "block" TEXT,
    "buildingClass" TEXT,
    "cdu" TEXT,
    "livingArea" INTEGER,
    "landSize" INTEGER,
    "yearBuilt" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(65,30),
    "exteriorWall" TEXT,
    "roofType" TEXT,
    "heatingType" TEXT,
    "currentAssessmentValue" DECIMAL(65,30),
    "currentLandValue" DECIMAL(65,30),
    "currentImprovementValue" DECIMAL(65,30),
    "currentMarketValue" DECIMAL(65,30),
    "taxCode" TEXT,
    "taxRate" DECIMAL(65,30),
    "stateEqualizer" DECIMAL(65,30),
    "lastCheckedAt" TIMESTAMP(3),
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentHistory" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "assessmentValue" DECIMAL(65,30) NOT NULL,
    "landValue" DECIMAL(65,30),
    "improvementValue" DECIMAL(65,30),
    "marketValue" DECIMAL(65,30),
    "previousAssessmentValue" DECIMAL(65,30),
    "changeAmount" DECIMAL(65,30),
    "changePercent" DECIMAL(65,30),
    "source" TEXT,
    "noticeDate" TIMESTAMP(3),
    "noticeDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssessmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appeal" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "parentAppealId" TEXT,
    "status" "AppealStatus" NOT NULL DEFAULT 'DRAFT',
    "originalAssessmentValue" DECIMAL(65,30) NOT NULL,
    "requestedAssessmentValue" DECIMAL(65,30),
    "finalAssessmentValue" DECIMAL(65,30),
    "appealType" "AppealType" NOT NULL DEFAULT 'ASSESSOR',
    "filingMethod" "FilingMethod" NOT NULL DEFAULT 'ELECTRONIC',
    "noticeDate" TIMESTAMP(3),
    "filingDeadline" TIMESTAMP(3) NOT NULL,
    "filedAt" TIMESTAMP(3),
    "decisionDate" TIMESTAMP(3),
    "outcome" "AppealOutcome",
    "reductionAmount" DECIMAL(65,30),
    "reductionPercent" DECIMAL(65,30),
    "taxSavings" DECIMAL(65,30),
    "taxRate" DECIMAL(65,30),
    "equalizationFactor" DECIMAL(65,30),
    "evidenceSummary" TEXT,
    "hearingScheduled" BOOLEAN NOT NULL DEFAULT false,
    "hearingDate" TIMESTAMP(3),
    "hearingLocation" TEXT,
    "notes" TEXT,
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparableProperty" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "compType" "CompType" NOT NULL,
    "pin" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IL',
    "zipCode" TEXT NOT NULL,
    "county" TEXT NOT NULL DEFAULT 'Cook',
    "neighborhood" TEXT,
    "subdivision" TEXT,
    "block" TEXT,
    "buildingClass" TEXT,
    "cdu" TEXT,
    "livingArea" INTEGER,
    "landSize" INTEGER,
    "yearBuilt" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(65,30),
    "exteriorWall" TEXT,
    "roofType" TEXT,
    "heatingType" TEXT,
    "distanceFromSubject" DECIMAL(65,30),
    "salePrice" DECIMAL(65,30),
    "saleDate" TIMESTAMP(3),
    "pricePerSqft" DECIMAL(65,30),
    "assessedMarketValue" DECIMAL(65,30),
    "assessedMarketValuePerSqft" DECIMAL(65,30),
    "landValue" DECIMAL(65,30),
    "improvementValue" DECIMAL(65,30),
    "sameNeighborhood" BOOLEAN NOT NULL DEFAULT false,
    "sameBuildingClass" BOOLEAN NOT NULL DEFAULT false,
    "sameCdu" BOOLEAN NOT NULL DEFAULT false,
    "livingAreaWithinRange" BOOLEAN NOT NULL DEFAULT false,
    "ageWithinRange" BOOLEAN NOT NULL DEFAULT false,
    "distanceWithinRange" BOOLEAN NOT NULL DEFAULT false,
    "dataSource" TEXT NOT NULL DEFAULT 'Cook County Open Data',
    "dataSourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparableProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RealieEnrichmentCache" (
    "id" TEXT NOT NULL,
    "pin" TEXT NOT NULL,
    "livingArea" INTEGER,
    "yearBuilt" INTEGER,
    "bedrooms" INTEGER,
    "bathrooms" DECIMAL(65,30),
    "rawResponse" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealieEnrichmentCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppealDocument" (
    "id" TEXT NOT NULL,
    "appealId" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "isPhoto" BOOLEAN NOT NULL DEFAULT false,
    "photoDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppealDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "invoiceType" "InvoiceType" NOT NULL,
    "subscriptionTier" "SubscriptionTier",
    "billingPeriodStart" TIMESTAMP(3),
    "billingPeriodEnd" TIMESTAMP(3),
    "performancePlanAppealIds" TEXT[],
    "taxSavingsTotal" DECIMAL(65,30),
    "taxSavingsBreakdown" JSONB,
    "feePercentage" DECIMAL(65,30) NOT NULL DEFAULT 0.04,
    "feeAmount" DECIMAL(65,30),
    "paymentOption" "PerformancePaymentOption",
    "installmentNumber" INTEGER,
    "propertyId" TEXT,
    "compPacketGenerated" BOOLEAN NOT NULL DEFAULT false,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "stripePaymentIntentId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "lateFeeAmount" DECIMAL(65,30),
    "collectionLettersSent" INTEGER NOT NULL DEFAULT 0,
    "lastCollectionLetterSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringJob" (
    "id" TEXT NOT NULL,
    "jobType" "MonitoringJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "propertiesChecked" INTEGER NOT NULL DEFAULT 0,
    "assessmentsFound" INTEGER NOT NULL DEFAULT 0,
    "appealsTriggered" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT[],
    "warnings" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitor_count" (
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "visitor_count_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "CountyConfig" (
    "id" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IL',
    "appealDeadlineDays" INTEGER NOT NULL DEFAULT 30,
    "appealTypes" TEXT[],
    "openDataUrl" TEXT,
    "apiUrl" TEXT,
    "apiKey" TEXT,
    "requiresPhotos" BOOLEAN NOT NULL DEFAULT true,
    "photoDateRequirement" INTEGER,
    "minCompsRequired" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_AppealToComparableProperty" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AppealToComparableProperty_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_subscriptionTier_idx" ON "User"("subscriptionTier");

-- CreateIndex
CREATE INDEX "User_subscriptionStatus_idx" ON "User"("subscriptionStatus");

-- CreateIndex
CREATE INDEX "TermsAcceptance_userId_idx" ON "TermsAcceptance"("userId");

-- CreateIndex
CREATE INDEX "TermsAcceptance_version_idx" ON "TermsAcceptance"("version");

-- CreateIndex
CREATE INDEX "Property_userId_idx" ON "Property"("userId");

-- CreateIndex
CREATE INDEX "Property_pin_idx" ON "Property"("pin");

-- CreateIndex
CREATE INDEX "Property_county_idx" ON "Property"("county");

-- CreateIndex
CREATE INDEX "Property_neighborhood_idx" ON "Property"("neighborhood");

-- CreateIndex
CREATE UNIQUE INDEX "Property_userId_pin_key" ON "Property"("userId", "pin");

-- CreateIndex
CREATE INDEX "AssessmentHistory_propertyId_idx" ON "AssessmentHistory"("propertyId");

-- CreateIndex
CREATE INDEX "AssessmentHistory_taxYear_idx" ON "AssessmentHistory"("taxYear");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentHistory_propertyId_taxYear_key" ON "AssessmentHistory"("propertyId", "taxYear");

-- CreateIndex
CREATE INDEX "Appeal_userId_idx" ON "Appeal"("userId");

-- CreateIndex
CREATE INDEX "Appeal_propertyId_idx" ON "Appeal"("propertyId");

-- CreateIndex
CREATE INDEX "Appeal_taxYear_idx" ON "Appeal"("taxYear");

-- CreateIndex
CREATE INDEX "Appeal_status_idx" ON "Appeal"("status");

-- CreateIndex
CREATE INDEX "Appeal_outcome_idx" ON "Appeal"("outcome");

-- CreateIndex
CREATE INDEX "Appeal_parentAppealId_idx" ON "Appeal"("parentAppealId");

-- CreateIndex
CREATE UNIQUE INDEX "Appeal_propertyId_taxYear_appealType_key" ON "Appeal"("propertyId", "taxYear", "appealType");

-- CreateIndex
CREATE INDEX "ComparableProperty_propertyId_idx" ON "ComparableProperty"("propertyId");

-- CreateIndex
CREATE INDEX "ComparableProperty_pin_idx" ON "ComparableProperty"("pin");

-- CreateIndex
CREATE INDEX "ComparableProperty_compType_idx" ON "ComparableProperty"("compType");

-- CreateIndex
CREATE INDEX "ComparableProperty_neighborhood_idx" ON "ComparableProperty"("neighborhood");

-- CreateIndex
CREATE UNIQUE INDEX "RealieEnrichmentCache_pin_key" ON "RealieEnrichmentCache"("pin");

-- CreateIndex
CREATE INDEX "RealieEnrichmentCache_pin_idx" ON "RealieEnrichmentCache"("pin");

-- CreateIndex
CREATE INDEX "AppealDocument_appealId_idx" ON "AppealDocument"("appealId");

-- CreateIndex
CREATE INDEX "AppealDocument_documentType_idx" ON "AppealDocument"("documentType");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_invoiceType_idx" ON "Invoice"("invoiceType");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "MonitoringJob_jobType_idx" ON "MonitoringJob"("jobType");

-- CreateIndex
CREATE INDEX "MonitoringJob_status_idx" ON "MonitoringJob"("status");

-- CreateIndex
CREATE INDEX "MonitoringJob_startedAt_idx" ON "MonitoringJob"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CountyConfig_county_key" ON "CountyConfig"("county");

-- CreateIndex
CREATE INDEX "CountyConfig_county_idx" ON "CountyConfig"("county");

-- CreateIndex
CREATE INDEX "CountyConfig_state_idx" ON "CountyConfig"("state");

-- CreateIndex
CREATE INDEX "_AppealToComparableProperty_B_index" ON "_AppealToComparableProperty"("B");

-- AddForeignKey
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentHistory" ADD CONSTRAINT "AssessmentHistory_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appeal" ADD CONSTRAINT "Appeal_parentAppealId_fkey" FOREIGN KEY ("parentAppealId") REFERENCES "Appeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparableProperty" ADD CONSTRAINT "ComparableProperty_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppealDocument" ADD CONSTRAINT "AppealDocument_appealId_fkey" FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AppealToComparableProperty" ADD CONSTRAINT "_AppealToComparableProperty_A_fkey" FOREIGN KEY ("A") REFERENCES "Appeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AppealToComparableProperty" ADD CONSTRAINT "_AppealToComparableProperty_B_fkey" FOREIGN KEY ("B") REFERENCES "ComparableProperty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
