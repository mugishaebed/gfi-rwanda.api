-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "disbursedAmount" DOUBLE PRECISION,
ADD COLUMN     "disbursedAt" TIMESTAMP(3),
ADD COLUMN     "totalInterestExpected" DOUBLE PRECISION,
ADD COLUMN     "totalInterestReceived" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "totalPrincipalRecovered" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Repayment" ADD COLUMN     "interestPaid" DOUBLE PRECISION,
ADD COLUMN     "principalPaid" DOUBLE PRECISION;
