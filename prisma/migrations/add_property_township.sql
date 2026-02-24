-- Add township to Property for schedule-based monitoring (check only when township appeal window is active)
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "township" TEXT;
