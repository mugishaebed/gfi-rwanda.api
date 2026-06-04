-- AddUnique column disbursementReference to Loan for MoMo disbursement tracking
ALTER TABLE "Loan" ADD COLUMN "disbursementReference" TEXT;
CREATE UNIQUE INDEX "Loan_disbursementReference_key" ON "Loan"("disbursementReference");
