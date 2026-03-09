-- Store drawn signature as base64 PNG (for embedding in PDF)
ALTER TABLE "FilingAuthorization" ADD COLUMN IF NOT EXISTS "signatureImageData" TEXT;
