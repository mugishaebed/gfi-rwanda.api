CREATE TYPE "LoanSource" AS ENUM ('CLIENT_ONLINE', 'STAFF_MANUAL');

ALTER TABLE "Loan"
ADD COLUMN "source" "LoanSource" NOT NULL DEFAULT 'STAFF_MANUAL';

UPDATE "Loan"
SET "source" = 'CLIENT_ONLINE'
WHERE "termsAccepted" = true
  AND "termsVersion" = 'loan-request-v1'
  AND "purpose" = 'Quick loan application';

CREATE INDEX "Loan_source_status_createdAt_idx" ON "Loan"("source", "status", "createdAt");
