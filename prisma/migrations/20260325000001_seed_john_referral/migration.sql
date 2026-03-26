-- Ensure John Grafft referral code exists
INSERT INTO "Referral" ("id", "code", "name", "visits", "conversions", "revenue", "createdAt", "updatedAt")
VALUES ('ref_john_grafft_001', 'john', 'John Grafft', 0, 0, 0, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
