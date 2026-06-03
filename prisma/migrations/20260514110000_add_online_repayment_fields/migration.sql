CREATE TYPE "RepaymentSource" AS ENUM ('STAFF_MANUAL', 'CLIENT_ONLINE');

CREATE TYPE "OnlinePaymentProvider" AS ENUM ('MOBILE_MONEY');

ALTER TABLE "Repayment"
ADD COLUMN "source" "RepaymentSource" NOT NULL DEFAULT 'STAFF_MANUAL',
ADD COLUMN "paymentProvider" "OnlinePaymentProvider",
ADD COLUMN "paymentReference" TEXT,
ADD COLUMN "paymentPhoneNumber" TEXT;

CREATE UNIQUE INDEX "Repayment_paymentReference_key" ON "Repayment"("paymentReference");

CREATE INDEX "Repayment_source_status_createdAt_idx" ON "Repayment"("source", "status", "createdAt");

CREATE INDEX "Repayment_loanId_createdAt_idx" ON "Repayment"("loanId", "createdAt");
