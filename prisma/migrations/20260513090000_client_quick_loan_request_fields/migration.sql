CREATE TYPE "DisbursementMethod" AS ENUM ('MOBILE_MONEY');

ALTER TABLE "Loan"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'RWF',
ADD COLUMN "termsAccepted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "termsVersion" TEXT,
ADD COLUMN "disbursementMethod" "DisbursementMethod" NOT NULL DEFAULT 'MOBILE_MONEY';
