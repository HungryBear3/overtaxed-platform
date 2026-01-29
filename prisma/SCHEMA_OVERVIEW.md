# Prisma Schema Overview

## Schema Created ✅

Comprehensive database schema for Overtaxed platform based on PRD requirements.

## Models Created

### 1. **User & Authentication**
- `User` - User accounts with subscription tiers, relationship attestation
- `TermsAcceptance` - Tracks Terms of Service acceptance with versioning

### 2. **Property Management**
- `Property` - Property details (PIN, address, Cook County data)
- `AssessmentHistory` - Year-over-year assessment tracking for change detection

### 3. **Appeals (Multi-Year Support)**
- `Appeal` - Appeals with tax year tracking, linked related appeals for 3-year savings
- `AppealDocument` - Documents attached to appeals (forms, photos, evidence)

### 4. **Comparable Properties (Comps)**
- `ComparableProperty` - Sales and equity comps from Cook County Open Data
- Supports both Sales Analysis (3+ comps) and Lack of Uniformity (5+ comps)

### 5. **Billing & Invoices**
- `Invoice` - Handles all invoice types:
  - Subscription (Starter, Growth, Portfolio)
  - Performance Plan (4% of 3-year savings with installments)
  - Comps-only ($69 per property)
  - Late fees and collection fees

### 6. **Monitoring & Automation**
- `MonitoringJob` - Tracks automated jobs (assessment checks, filing, comp generation)

### 7. **County Configuration**
- `CountyConfig` - Multi-county architecture (MVP: Cook County only, but ready for expansion)

## Key Features Implemented

### ✅ Multi-Year Appeals
- Appeals tracked by `taxYear`
- `parentAppealId` links related appeals (same property, different years)
- Enables 3-year savings calculation across related appeals

### ✅ Performance Plan (4% of 3-Year Savings)
- `performancePlanStartDate` tracks when 3-year period begins
- `taxSavings` calculated per appeal (reduction × tax rate × equalization factor)
- `performancePlanPaymentOption` (upfront or installments)
- Invoice model supports installment tracking

### ✅ Outcome Data Storage
- `Appeal.outcome` (WON, PARTIALLY_WON, DENIED, WITHDRAWN)
- `Appeal.compsUsed` links to comps used in each appeal
- `Appeal.evidenceSummary` stores evidence details
- Enables win-rate analysis and improvement over time

### ✅ Relationship Attestation
- `User.relationshipAttestation` (OWNER or AUTHORIZED)
- `User.attestationDate` tracks when attestation was made
- No identity verification required (per PRD §1.6a)

### ✅ Terms of Service Tracking
- `TermsAcceptance` model with version tracking
- Tracks acceptance of Terms of Service, User Agreement, and relationship attestation
- Supports re-acceptance when terms change

### ✅ Cook County Specific
- Property fields match Cook County Open Data structure
- PIN, neighborhood, subdivision, building class, CDU
- Assessment values (land, improvement, market)
- Appeal types (Assessor, Board of Review, Certificate of Error)

### ✅ Collections Support
- `Invoice.lateFeeAmount` (1.5% per month)
- `Invoice.collectionLettersSent` tracks collection letters
- `Invoice.lastCollectionLetterSentAt` for timing

### ✅ Data Retention
- `User.deletedAt` for soft delete (7-year retention)
- Anonymized outcome data can be retained after account deletion

## Enums Defined

- `UserRole` - USER, ADMIN
- `RelationshipType` - OWNER, AUTHORIZED
- `SubscriptionTier` - COMPS_ONLY, STARTER, GROWTH, PORTFOLIO, PERFORMANCE
- `SubscriptionStatus` - INACTIVE, ACTIVE, CANCELLED, EXPIRED, PAST_DUE
- `PerformancePaymentOption` - UPFRONT, INSTALLMENTS
- `AppealStatus` - DRAFT through DECISION_PENDING, APPROVED, DENIED, etc.
- `AppealType` - ASSESSOR, BOARD_REVIEW, CERTIFICATE_ERROR
- `AppealOutcome` - WON, PARTIALLY_WON, DENIED, WITHDRAWN
- `CompType` - SALES, EQUITY
- `DocumentType` - APPEAL_FORM, COMP_PACKET, PHOTO, etc.
- `InvoiceType` - SUBSCRIPTION, PERFORMANCE_FEE, COMPS_ONLY, LATE_FEE, COLLECTION_FEE
- `InvoiceStatus` - PENDING, PAID, OVERDUE, CANCELLED, REFUNDED
- `MonitoringJobType` - ASSESSMENT_CHECK, APPEAL_FILING, COMP_GENERATION, etc.
- `JobStatus` - PENDING, RUNNING, COMPLETED, FAILED

## Indexes Created

- User: email, subscriptionTier, subscriptionStatus
- Property: userId, pin, county, neighborhood
- AssessmentHistory: propertyId, taxYear
- Appeal: userId, propertyId, taxYear, status, outcome, parentAppealId
- ComparableProperty: propertyId, pin, compType, neighborhood
- Invoice: userId, status, invoiceType, dueDate
- MonitoringJob: jobType, status, startedAt

## Next Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Generate Prisma client:**
   ```bash
   npm run db:generate
   ```

3. **Set up Supabase database:**
   - Create project
   - Get connection strings
   - Update `.env.local`

4. **Run initial migration:**
   ```bash
   npm run db:migrate
   ```

5. **Start building features:**
   - Authentication (NextAuth.js)
   - Property management
   - Appeal filing
   - Comps engine

## Schema Highlights

- **Multi-county ready:** `CountyConfig` model supports adding other counties later
- **Performance Plan ready:** Full support for 4% of 3-year savings with installments
- **Outcome tracking:** Comprehensive data for win-rate improvement
- **Collections ready:** Late fees, collection letters, legal action tracking
- **Terms tracking:** Version-controlled Terms of Service acceptance
- **Soft deletes:** Data retention support (7 years minimum)

The schema is production-ready and aligns with all PRD requirements! 🚀
