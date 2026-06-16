-- Add an optional economic sector to loans, used at manual loan creation, on
-- the loan-officer dashboard (filtering), and for cross-sector insights.
-- Nullable: existing loans and client quick-loans carry no sector.

CREATE TYPE "LoanSector" AS ENUM (
  'COFFEE',
  'GENERAL_TRADE',
  'CONSTRUCTION',
  'REAL_ESTATE',
  'TENDERS',
  'HOSPITALITY'
);

ALTER TABLE "Loan" ADD COLUMN "sector" "LoanSector";

CREATE INDEX "Loan_sector_status_idx" ON "Loan"("sector", "status");
