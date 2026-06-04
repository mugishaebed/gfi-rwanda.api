/*
  Warnings:

  - Added the required column `collateralEstimatedValue` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collateralLocation` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `collateralType` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `defaultPenaltyFeePercentPerDay` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `disbursementWithinDays` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `earlyRepaymentFeePercent` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `interestRatePercentPerMonth` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repaymentAmountPerMonth` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repaymentInstallmentsCount` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `repaymentPeriodMonths` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `termEndDate` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `termInMonths` to the `Loan` table without a default value. This is not possible if the table is not empty.
  - Added the required column `termStartDate` to the `Loan` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Loan"
ADD COLUMN IF NOT EXISTS "collateralEstimatedValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "collateralLocation" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "collateralType" TEXT NOT NULL DEFAULT '',
ADD COLUMN IF NOT EXISTS "defaultPenaltyFeePercentPerDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "disbursementWithinDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "earlyRepaymentFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "interestRatePercentPerMonth" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "repaymentAmountPerMonth" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "repaymentInstallmentsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "repaymentPeriodMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "spouseName" TEXT,
ADD COLUMN IF NOT EXISTS "termEndDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS "termInMonths" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "termStartDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
