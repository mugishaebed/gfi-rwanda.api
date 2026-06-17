/**
 * One-off backfill for the manual-loan principal/interest split.
 *
 * Historically, manual repayments stored no principal/interest split and the
 * loan's outstandingBalance was decremented by the full amount paid (principal
 * + interest). This script replays each manual loan's APPROVED manual
 * repayments in chronological order, applies the declining-balance split
 * (interest on the outstanding principal first, remainder to principal), and
 * recomputes the loan's outstandingBalance / totalInterestReceived /
 * totalPrincipalRecovered to match.
 *
 * It is intentionally NOT wired into the app. Review against live data, then run:
 *
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-manual-repayment-splits.ts          # dry run
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-manual-repayment-splits.ts --apply  # write changes
 *
 * Notes:
 *  - Only loans with source = STAFF_MANUAL are touched.
 *  - Only APPROVED repayments affect balances; PENDING/REJECTED are left as-is.
 *  - Re-running is safe: balances are recomputed from the principal each time.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { LoanSource, RepaymentStatus } from '../src/generated/prisma/enums';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL must be set');
}
const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const round = (n: number) => Math.round(n);

function computeSplit(
  outstandingPrincipal: number,
  ratePercentPerMonth: number,
  amountPaid: number,
) {
  const interestDue = round(outstandingPrincipal * (ratePercentPerMonth / 100));
  const interestPaid = Math.min(amountPaid, Math.max(interestDue, 0));
  const principalPaid = round(amountPaid - interestPaid);
  return { principalPaid, interestPaid };
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(
    apply
      ? 'Running backfill (writing changes)...'
      : 'DRY RUN (no writes). Pass --apply to persist.',
  );

  const loans = await prisma.loan.findMany({
    where: { source: LoanSource.STAFF_MANUAL },
    select: { id: true, amount: true, interestRatePercentPerMonth: true },
  });

  let loansChanged = 0;

  for (const loan of loans) {
    const repayments = await prisma.repayment.findMany({
      where: { loanId: loan.id, status: RepaymentStatus.APPROVED },
      orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        amountPaid: true,
        principalPaid: true,
        interestPaid: true,
      },
    });

    let principal = loan.amount;
    let totalInterestReceived = 0;
    let totalPrincipalRecovered = 0;
    const updates: Array<{
      id: string;
      principalPaid: number;
      interestPaid: number;
    }> = [];

    for (const r of repayments) {
      const split = computeSplit(
        principal,
        loan.interestRatePercentPerMonth,
        r.amountPaid,
      );
      principal = round(principal - split.principalPaid);
      totalInterestReceived += split.interestPaid;
      totalPrincipalRecovered += split.principalPaid;

      if (
        r.principalPaid !== split.principalPaid ||
        r.interestPaid !== split.interestPaid
      ) {
        updates.push({ id: r.id, ...split });
      }
    }

    const outstandingBalance = Math.max(principal, 0);

    console.log(
      `Loan ${loan.id}: outstanding -> ${outstandingBalance}, interestReceived -> ${totalInterestReceived}, principalRecovered -> ${totalPrincipalRecovered} (${updates.length} repayment splits to set)`,
    );

    if (!apply) continue;

    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.repayment.update({
          where: { id: u.id },
          data: {
            principalPaid: u.principalPaid,
            interestPaid: u.interestPaid,
          },
        });
      }
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          outstandingBalance,
          totalInterestReceived,
          totalPrincipalRecovered,
        },
      });
    });
    loansChanged += 1;
  }

  console.log(
    apply
      ? `Done. ${loansChanged}/${loans.length} manual loans reconciled.`
      : `Dry run complete over ${loans.length} manual loans.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
