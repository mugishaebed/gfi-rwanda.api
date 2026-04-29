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
ALTER TABLE "Loan" ADD COLUMN     "collateralEstimatedValue" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "collateralLocation" TEXT NOT NULL,
ADD COLUMN     "collateralType" TEXT NOT NULL,
ADD COLUMN     "defaultPenaltyFeePercentPerDay" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "disbursementWithinDays" INTEGER NOT NULL,
ADD COLUMN     "earlyRepaymentFeePercent" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "interestRatePercentPerMonth" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "repaymentAmountPerMonth" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "repaymentInstallmentsCount" INTEGER NOT NULL,
ADD COLUMN     "repaymentPeriodMonths" INTEGER NOT NULL,
ADD COLUMN     "spouseName" TEXT,
ADD COLUMN     "termEndDate" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "termInMonths" INTEGER NOT NULL,
ADD COLUMN     "termStartDate" TIMESTAMP(3) NOT NULL;
