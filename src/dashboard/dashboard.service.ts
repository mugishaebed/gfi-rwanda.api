import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import {
  LoanSector,
  LoanSource,
  LoanStatus,
  RepaymentStatus,
} from '../generated/prisma/enums';
import { PrismaService } from '../prisma.service';
import { formatLoanNumber } from '../loans/loan-number';

export type GmSummaryPeriod = 'month' | 'quarter' | 'ytd';

type ClientWithNames = {
  individual?: { fullName: string } | null;
  business?: { businessName: string } | null;
} | null;

type ActivityType =
  | 'application'
  | 'officer_approval'
  | 'gm_approval'
  | 'rejection'
  | 'disbursing'
  | 'disbursement'
  | 'disbursement_failed'
  | 'status_change';

const TREND_MONTHS = 12;
const THROUGHPUT_WEEKS = 8;
const ACTIVITY_LIMIT = 8;
const WORKLIST_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /* ───────────────────────── GM (institution-wide) ───────────────────────── */

  async getGmSummary(period: GmSummaryPeriod = 'month') {
    const now = new Date();
    const start = this.startOfPeriod(now, period);
    // "Immediately preceding comparable window": same elapsed length before start.
    const prevStart = new Date(start.getTime() - (now.getTime() - start.getTime()));

    const [
      disbursedCurr,
      disbursedPrev,
      interestCurr,
      interestPrev,
      bookOutstanding,
      bookTotals,
      interestTotals,
      sectorRows,
      statusRows,
      pendingRepayments,
      onlineReview,
      manualReview,
      counts,
      trend,
      activity,
    ] = await Promise.all([
      this.sumDisbursed(start, now),
      this.sumDisbursed(prevStart, start),
      this.sumInterestPaid(start, now),
      this.sumInterestPaid(prevStart, start),
      this.aggregateSum('outstandingBalance'),
      this.prisma.loan.aggregate({
        _sum: { disbursedAmount: true, totalPrincipalRecovered: true },
      }),
      this.prisma.loan.aggregate({
        _sum: { totalInterestReceived: true, totalInterestExpected: true },
      }),
      this.prisma.loan.groupBy({
        by: ['sector'],
        where: { sector: { not: null } },
        _count: { _all: true },
        _sum: { disbursedAmount: true },
      }),
      this.prisma.loan.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.repayment.count({ where: { status: RepaymentStatus.PENDING } }),
      this.prisma.loan.count({
        where: {
          status: LoanStatus.PENDING_OFFICER_REVIEW,
          source: LoanSource.CLIENT_ONLINE,
        },
      }),
      this.prisma.loan.count({
        where: {
          status: LoanStatus.PENDING_GM_APPROVAL,
          source: LoanSource.STAFF_MANUAL,
        },
      }),
      this.pipelineCounts({}),
      this.buildTrend(now),
      this.buildActivity({}),
    ]);

    const disbursedAll = bookTotals._sum.disbursedAmount ?? 0;
    const principalAll = bookTotals._sum.totalPrincipalRecovered ?? 0;
    const recoveryRate =
      disbursedAll > 0 ? Math.round((principalAll / disbursedAll) * 100) : 0;

    return {
      kpis: {
        // Flow metric: amount disbursed within the selected period.
        disbursed: {
          value: disbursedCurr,
          deltaPct: this.deltaPct(disbursedCurr, disbursedPrev),
        },
        // Cumulative all-time total disbursed across every loan. Monotonic
        // stock metric — unaffected by repayment or period changes.
        disbursedTotal: { value: disbursedAll, deltaPct: 0 },
        // Point-in-time stock metric: no historical snapshot to diff against.
        outstanding: { value: bookOutstanding, deltaPct: 0 },
        interestEarned: {
          value: interestCurr,
          deltaPct: this.deltaPct(interestCurr, interestPrev),
        },
        recoveryRate: { value: recoveryRate, deltaPct: 0 },
      },
      trend,
      sectors: sectorRows.map((r) => ({
        sector: r.sector as LoanSector,
        loans: r._count._all,
        disbursed: r._sum.disbursedAmount ?? 0,
      })),
      statuses: statusRows.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
      pipeline: counts,
      interest: {
        received: interestTotals._sum.totalInterestReceived ?? 0,
        expected: interestTotals._sum.totalInterestExpected ?? 0,
      },
      queues: {
        awaitingGm: counts.gmApproval,
        pendingRepayments,
        onlineReview,
        manualReview,
      },
      activity,
    };
  }

  /* ─────────────────────── Officer (scoped to caller) ─────────────────────── */

  async getOfficerSummary(officerId: string) {
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const prevMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const nextMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const own: Prisma.LoanWhereInput = { userId: officerId };
    const ownRepayment: Prisma.RepaymentWhereInput = { loan: { userId: officerId } };

    const [
      activeLoans,
      awaitingGm,
      toReview,
      collectionsCurr,
      reviewLoans,
      activeLoanRecords,
      pipeline,
      throughput,
      activity,
    ] = await Promise.all([
      this.prisma.loan.count({ where: { ...own, status: LoanStatus.ACTIVE } }),
      this.prisma.loan.count({
        where: { ...own, status: LoanStatus.PENDING_GM_APPROVAL },
      }),
      // Loans awaiting officer review are not assigned to a specific officer,
      // so this is the shared review pool, not an owner-scoped count.
      this.prisma.loan.count({
        where: { status: LoanStatus.PENDING_OFFICER_REVIEW },
      }),
      this.sumRepaid(monthStart, now, ownRepayment),
      this.prisma.loan.findMany({
        where: { status: LoanStatus.PENDING_OFFICER_REVIEW },
        orderBy: { createdAt: 'asc' },
        take: WORKLIST_LIMIT,
        include: { client: { include: { individual: true, business: true } } },
      }),
      this.prisma.loan.findMany({
        where: { ...own, status: LoanStatus.ACTIVE },
        include: { client: { include: { individual: true, business: true } } },
      }),
      this.pipelineByStatus(own),
      this.buildOfficerThroughput(officerId, now),
      this.buildActivity(own),
    ]);

    const reviewQueue = reviewLoans.map((loan) => ({
      loanId: loan.id,
      loanNumber: formatLoanNumber(loan),
      client: this.clientName(loan.client),
      sector: loan.sector,
      amount: loan.amount,
      source: loan.source,
      submittedAt: loan.createdAt.toISOString(),
    }));

    const repaymentsDue: Array<{
      loanId: string;
      loanNumber: string;
      client: string;
      amount: number;
      dueDate: string;
    }> = [];
    let dueThisMonth = 0;

    for (const loan of activeLoanRecords) {
      const schedule = this.extractSchedule(loan.repaymentTerms);

      dueThisMonth += schedule
        .filter(
          (item) =>
            item.dueDate >= monthStart && item.dueDate < nextMonthStart,
        )
        .reduce((sum, item) => sum + item.amount, 0);

      // A loan with no outstanding principal is fully settled and owes nothing,
      // regardless of what calendar dates its schedule still carries.
      if (loan.outstandingBalance <= 0) {
        continue;
      }

      const next = this.nextUnpaidInstallment(schedule, loan.totalRepaidAmount);
      if (next) {
        repaymentsDue.push({
          loanId: loan.id,
          loanNumber: formatLoanNumber(loan),
          client: this.clientName(loan.client),
          amount: next.amount,
          dueDate: this.dateOnly(next.dueDate),
        });
      }
    }

    repaymentsDue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    return {
      kpis: {
        // Count-based KPIs are point-in-time stock; we don't snapshot history,
        // so their deltaPct is 0 per the "previous unknown" convention.
        toReview: { value: toReview, deltaPct: 0 },
        awaitingGm: { value: awaitingGm, deltaPct: 0 },
        collections: {
          value: collectionsCurr,
          deltaPct: this.deltaPct(
            collectionsCurr,
            await this.sumRepaid(prevMonthStart, monthStart, ownRepayment),
          ),
        },
        activeLoans: { value: activeLoans, deltaPct: 0 },
      },
      reviewQueue,
      repaymentsDue,
      collections: { recorded: collectionsCurr, target: dueThisMonth },
      throughput,
      pipeline,
      activity,
    };
  }

  /* ───────────────────────────── helpers ───────────────────────────── */

  private startOfPeriod(now: Date, period: GmSummaryPeriod): Date {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    if (period === 'ytd') {
      return new Date(Date.UTC(y, 0, 1));
    }
    if (period === 'quarter') {
      return new Date(Date.UTC(y, Math.floor(m / 3) * 3, 1));
    }
    return new Date(Date.UTC(y, m, 1));
  }

  private deltaPct(current: number, previous: number): number {
    if (!previous) {
      return 0;
    }
    return Math.round(((current - previous) / previous) * 1000) / 10;
  }

  private async aggregateSum(
    field: 'outstandingBalance',
  ): Promise<number> {
    // Outstanding = principal actually disbursed and still being repaid. Loans
    // pending review/approval or rejected have not been disbursed, so they must
    // not inflate the book outstanding figure even though outstandingBalance is
    // seeded at creation time.
    const r = await this.prisma.loan.aggregate({
      _sum: { [field]: true },
      where: { status: LoanStatus.ACTIVE },
    });
    return r._sum[field] ?? 0;
  }

  private async sumDisbursed(from: Date, to: Date): Promise<number> {
    const r = await this.prisma.loan.aggregate({
      _sum: { disbursedAmount: true },
      where: { disbursedAt: { gte: from, lt: to } },
    });
    return r._sum.disbursedAmount ?? 0;
  }

  private async sumInterestPaid(from: Date, to: Date): Promise<number> {
    const r = await this.prisma.repayment.aggregate({
      _sum: { interestPaid: true },
      where: { status: RepaymentStatus.APPROVED, approvedAt: { gte: from, lt: to } },
    });
    return r._sum.interestPaid ?? 0;
  }

  private async sumRepaid(
    from: Date,
    to: Date,
    extra: Prisma.RepaymentWhereInput = {},
  ): Promise<number> {
    const r = await this.prisma.repayment.aggregate({
      _sum: { amountPaid: true },
      where: {
        status: RepaymentStatus.APPROVED,
        approvedAt: { gte: from, lt: to },
        ...extra,
      },
    });
    return r._sum.amountPaid ?? 0;
  }

  private async pipelineCounts(where: Prisma.LoanWhereInput) {
    const [officerReview, gmApproval, disbursing, active] = await Promise.all([
      this.prisma.loan.count({
        where: { ...where, status: LoanStatus.PENDING_OFFICER_REVIEW },
      }),
      this.prisma.loan.count({
        where: { ...where, status: LoanStatus.PENDING_GM_APPROVAL },
      }),
      this.prisma.loan.count({
        where: { ...where, status: LoanStatus.DISBURSING },
      }),
      this.prisma.loan.count({ where: { ...where, status: LoanStatus.ACTIVE } }),
    ]);
    return { officerReview, gmApproval, disbursing, active };
  }

  private async pipelineByStatus(where: Prisma.LoanWhereInput) {
    const rows = await this.prisma.loan.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    return rows.map((r) => ({ status: r.status, count: r._count._all }));
  }

  private async buildTrend(now: Date) {
    const firstMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (TREND_MONTHS - 1), 1),
    );
    const buckets = new Map<string, { disbursed: number; repaid: number }>();
    for (let i = 0; i < TREND_MONTHS; i++) {
      const d = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth() - (TREND_MONTHS - 1) + i,
          1,
        ),
      );
      buckets.set(this.monthKey(d), { disbursed: 0, repaid: 0 });
    }

    const [loans, repayments] = await Promise.all([
      this.prisma.loan.findMany({
        where: { disbursedAt: { gte: firstMonth } },
        select: { disbursedAmount: true, disbursedAt: true },
      }),
      this.prisma.repayment.findMany({
        where: { status: RepaymentStatus.APPROVED, approvedAt: { gte: firstMonth } },
        select: { amountPaid: true, approvedAt: true },
      }),
    ]);

    for (const loan of loans) {
      if (!loan.disbursedAt) continue;
      const bucket = buckets.get(this.monthKey(loan.disbursedAt));
      if (bucket) bucket.disbursed += loan.disbursedAmount ?? 0;
    }
    for (const repayment of repayments) {
      if (!repayment.approvedAt) continue;
      const bucket = buckets.get(this.monthKey(repayment.approvedAt));
      if (bucket) bucket.repaid += repayment.amountPaid ?? 0;
    }

    return Array.from(buckets.entries()).map(([month, v]) => ({
      month,
      disbursed: v.disbursed,
      repaid: v.repaid,
    }));
  }

  private async buildOfficerThroughput(officerId: string, now: Date) {
    const since = new Date(now.getTime() - THROUGHPUT_WEEKS * 7 * DAY_MS);
    const buckets = new Map<string, { submitted: number; approved: number }>();
    for (let i = THROUGHPUT_WEEKS - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 7 * DAY_MS);
      buckets.set(this.isoWeekKey(d), { submitted: 0, approved: 0 });
    }

    const [submitted, approved] = await Promise.all([
      this.prisma.loan.findMany({
        where: { userId: officerId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      this.prisma.loanStatusLog.findMany({
        where: {
          toStatus: LoanStatus.APPROVED,
          createdAt: { gte: since },
          loan: { userId: officerId },
        },
        select: { createdAt: true },
      }),
    ]);

    for (const loan of submitted) {
      const bucket = buckets.get(this.isoWeekKey(loan.createdAt));
      if (bucket) bucket.submitted += 1;
    }
    for (const log of approved) {
      const bucket = buckets.get(this.isoWeekKey(log.createdAt));
      if (bucket) bucket.approved += 1;
    }

    return Array.from(buckets.entries()).map(([week, v]) => ({
      week,
      submitted: v.submitted,
      approved: v.approved,
    }));
  }

  private async buildActivity(loanWhere: Prisma.LoanWhereInput) {
    const scoped = Object.keys(loanWhere).length > 0;
    const loanInclude = {
      client: { include: { individual: true, business: true } },
    } as const;

    const [logs, created] = await Promise.all([
      this.prisma.loanStatusLog.findMany({
        where: scoped ? { loan: loanWhere } : {},
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_LIMIT,
        include: { loan: { include: loanInclude } },
      }),
      this.prisma.loan.findMany({
        where: loanWhere,
        orderBy: { createdAt: 'desc' },
        take: ACTIVITY_LIMIT,
        include: loanInclude,
      }),
    ]);

    const items = [
      ...logs.map((log) => ({
        id: log.id,
        type: this.activityType(log.toStatus),
        loanId: log.loanId,
        loanNumber: formatLoanNumber(log.loan),
        client: this.clientName(log.loan.client),
        amount: log.loan.amount,
        at: log.createdAt.toISOString(),
      })),
      ...created.map((loan) => ({
        id: `loan:${loan.id}`,
        type: 'application' as ActivityType,
        loanId: loan.id,
        loanNumber: formatLoanNumber(loan),
        client: this.clientName(loan.client),
        amount: loan.amount,
        at: loan.createdAt.toISOString(),
      })),
    ];

    return items
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, ACTIVITY_LIMIT);
  }

  private activityType(toStatus: LoanStatus): ActivityType {
    switch (toStatus) {
      case LoanStatus.PENDING_GM_APPROVAL:
        return 'officer_approval';
      case LoanStatus.APPROVED:
        return 'gm_approval';
      case LoanStatus.REJECTED:
        return 'rejection';
      case LoanStatus.DISBURSING:
        return 'disbursing';
      case LoanStatus.ACTIVE:
        return 'disbursement';
      case LoanStatus.DISBURSEMENT_FAILED:
        return 'disbursement_failed';
      default:
        return 'status_change';
    }
  }

  private extractSchedule(
    repaymentTerms: Prisma.JsonValue,
  ): Array<{ dueDate: Date; amount: number }> {
    const schedule =
      (repaymentTerms as { schedule?: Array<{ dueDate: string; amount: number }> })
        ?.schedule ?? [];
    return schedule
      .map((item) => ({ dueDate: new Date(item.dueDate), amount: item.amount }))
      .filter((item) => !Number.isNaN(item.dueDate.getTime()))
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }

  // Returns the earliest installment not yet covered by approved repayments.
  // The schedule carries no per-installment paid flag, so settlement is derived
  // by walking installments in date order and consuming the loan's cumulative
  // repaid amount against each. Returns null when payments cover the whole
  // schedule (nothing left due). The reported amount is the still-outstanding
  // portion of that installment, so a partially paid installment shows only its
  // remainder.
  private nextUnpaidInstallment(
    schedule: Array<{ dueDate: Date; amount: number }>,
    totalRepaid: number,
  ): { dueDate: Date; amount: number } | null {
    let cumulative = 0;
    for (const item of schedule) {
      cumulative += item.amount;
      // Half-unit tolerance absorbs currency rounding between the schedule
      // amounts and the recorded repayment totals.
      if (totalRepaid < cumulative - 0.5) {
        return {
          dueDate: item.dueDate,
          amount: Math.min(item.amount, cumulative - totalRepaid),
        };
      }
    }
    return null;
  }

  private monthKey(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private isoWeekKey(d: Date): string {
    const date = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
    date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
    const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
    const week =
      1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  private dateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private clientName(client: ClientWithNames): string {
    return (
      client?.individual?.fullName ?? client?.business?.businessName ?? 'Client'
    );
  }
}
