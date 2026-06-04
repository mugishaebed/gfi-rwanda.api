import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import type { Prisma } from '../generated/prisma/client';
import {
  ClientOnboardingStatus,
  DisbursementMethod,
  DocumentOwnerType,
  LoanSource,
  LoanStatus,
  RepaymentStatus,
  UserRole,
} from '../generated/prisma/enums';
import { DocumentsService } from '../documents/documents.service';
import { MomoDisbursementsService } from '../momo/momo-disbursements.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import {
  CLIENT_LOAN_CURRENCY,
  CLIENT_LOAN_TERM_IN_MONTHS,
  CLIENT_LOAN_TERMS_VERSION,
  ClientLoanRequestDto,
} from './dto/client-loan-request.dto';
import { CreateLoanDto } from './dto/create-loan.dto';
import { formatLoanNumber, withLoanNumber } from './loan-number';
import { ReviewLoanDto } from './dto/review-loan.dto';

const CLIENT_LOAN_PURPOSE = 'Quick loan application';
const CLIENT_LOAN_INTEREST_RATE_PERCENT_PER_MONTH = 10;
const CLIENT_LOAN_DISBURSEMENT_WITHIN_DAYS = 0;
const CLIENT_LOAN_COLLATERAL_TYPE = 'N/A';
const CLIENT_LOAN_COLLATERAL_LOCATION = 'N/A';
const CLIENT_LOAN_FEE_PERCENT = 0;
const CLIENT_LOAN_OFFER_AVAILABLE_LIMIT = 500000;
const CLIENT_LOAN_OFFER_MINIMUM_REQUEST = 100;
const CLIENT_LOAN_OFFER_REVIEW_HOURS = 24;
const RWANDA_TIME_ZONE = 'Africa/Kigali';
const LOAN_STATUS_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

type ClientFacingLoanStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'overdue'
  | 'rejected';

@Injectable()
export class LoansService {
  private readonly logger = new Logger(LoansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
    private readonly momoDisbursements: MomoDisbursementsService,
  ) {}

  async findAll(
    page = 1,
    limit = 10,
    status?: LoanStatus,
    source?: LoanSource,
  ) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.LoanWhereInput = {
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    };

    const [loans, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          client: {
            include: {
              individual: true,
              business: true,
            },
          },
          user: true,
          statusLogs: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      }),
      this.prisma.loan.count({ where }),
    ]);

    return {
      data: await this.documentsService.attachDocuments(
        DocumentOwnerType.LOAN,
        loans.map((loan) => withLoanNumber(loan)),
      ),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findMyLoans(
    clientUserId: string,
    page = 1,
    limit = 10,
    status?: LoanStatus,
  ) {
    await this.ensureClientAccountIsActive(clientUserId);

    const client = await this.prisma.client.findUnique({
      where: { userId: clientUserId },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client profile not found for this account');
    }

    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where = {
      clientId: client.id,
      ...(status ? { status } : {}),
    };

    const [loans, total] = await Promise.all([
      this.prisma.loan.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: { createdAt: 'desc' },
        include: {
          client: {
            include: {
              individual: true,
              business: true,
            },
          },
          user: true,
          statusLogs: {
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      }),
      this.prisma.loan.count({ where }),
    ]);

    return {
      data: await this.documentsService.attachDocuments(
        DocumentOwnerType.LOAN,
        loans.map((loan) => withLoanNumber(loan)),
      ),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findOne(id: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id },
      include: {
        client: {
          include: {
            individual: true,
            business: true,
          },
        },
        user: true,
        statusLogs: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
        withLoanNumber(loan),
      ])
    )[0];
  }

  async createLoan(
    data: CreateLoanDto,
    createdByUserId: string,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
  ) {
    return this.createLoanInternal(
      data,
      data.clientId,
      createdByUserId,
      files,
      LoanStatus.PENDING,
      null,
    );
  }

  async requestLoanAsClient(
    data: ClientLoanRequestDto,
    createdByUserId: string,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
  ) {
    await this.ensureClientAccountIsActive(createdByUserId);

    const client = await this.prisma.client.findUnique({
      where: { userId: createdByUserId },
      select: {
        id: true,
        phoneNumber: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Client profile not found for this account');
    }

    return this.createClientLoanRequestInternal(
      data,
      client,
      createdByUserId,
      files,
    );
  }

  private async ensureClientAccountIsActive(clientUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: clientUserId },
      select: { clientOnboardingStatus: true, roles: true },
    });

    if (!user || !user.roles.includes(UserRole.CLIENT)) {
      throw new NotFoundException('Client account not found');
    }

    if (user.clientOnboardingStatus !== ClientOnboardingStatus.ACTIVE) {
      throw new BadRequestException(
        'Client account is pending approval by loan officer',
      );
    }
  }

  async approveLoanByOfficer(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    const loan = await this.updateLoanStatus(
      id,
      LoanStatus.LOAN_OFFICER_APPROVED,
      review,
      reviewedByUserId,
      [LoanStatus.PENDING],
      true,
    );

    await this.notificationsService.notifyGeneralManagersLoanPendingApproval({
      loanId: loan.id,
      amount: loan.amount,
      purpose: loan.purpose,
      clientName: this.getClientDisplayName(loan.client),
      loanOfficerName: loan.user?.name,
    });

    return loan;
  }

  async rejectLoanByOfficer(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    return this.updateLoanStatus(
      id,
      LoanStatus.LOAN_OFFICER_REJECTED,
      review,
      reviewedByUserId,
      [LoanStatus.PENDING],
      true,
    );
  }

  async approveLoanByGeneralManager(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
    reviewedByUserRoles: string[] = [],
  ) {
    if (reviewedByUserRoles.includes(UserRole.LOAN_OFFICER)) {
      const loan = await this.prisma.loan.findUnique({
        where: { id },
        select: { status: true },
      });

      if (!loan) {
        throw new NotFoundException('Loan not found');
      }

      if (loan.status === LoanStatus.PENDING) {
        return this.approvePendingLoanByDualRoleUser(
          id,
          review,
          reviewedByUserId,
        );
      }
    }

    return this.updateLoanStatus(
      id,
      LoanStatus.APPROVED,
      review,
      reviewedByUserId,
      [LoanStatus.LOAN_OFFICER_APPROVED],
      false,
    );
  }

  private async approvePendingLoanByDualRoleUser(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    const loanId = await this.prisma.$transaction(async (tx) => {
      const existingLoan = await tx.loan.findUnique({
        where: { id },
      });

      if (!existingLoan) {
        throw new NotFoundException('Loan not found');
      }

      if (existingLoan.status !== LoanStatus.PENDING) {
        throw new BadRequestException(
          `Loan cannot be moved from ${existingLoan.status} to ${LoanStatus.APPROVED}`,
        );
      }

      await tx.loanStatusLog.createMany({
        data: [
          {
            loanId: existingLoan.id,
            fromStatus: LoanStatus.PENDING,
            toStatus: LoanStatus.LOAN_OFFICER_APPROVED,
            changedBy: reviewedByUserId,
            note: review.note,
          },
          {
            loanId: existingLoan.id,
            fromStatus: LoanStatus.LOAN_OFFICER_APPROVED,
            toStatus: LoanStatus.APPROVED,
            changedBy: reviewedByUserId,
            note: review.note,
          },
        ],
      });

      await tx.loan.update({
        where: { id: existingLoan.id },
        data: {
          status: LoanStatus.APPROVED,
          userId: existingLoan.userId ?? reviewedByUserId,
          activatedAt: new Date(),
        },
      });

      return existingLoan.id;
    }, LOAN_STATUS_TRANSACTION_OPTIONS);

    const loan = await this.findLoanForReviewResponse(loanId);

    await this.generateAndAttachLoanContractPdf(loan.id, reviewedByUserId);

    await this.notificationsService.notifyLoanOfficerLoanApproved({
      loanId: loan.id,
      amount: loan.amount,
      clientName: this.getClientDisplayName(loan.client),
      loanOfficerEmail: loan.user?.email,
      loanOfficerName: loan.user?.name,
    });

    await this.disburseMomoLoan(loan.id);

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
        withLoanNumber(loan),
      ])
    )[0];
  }

  async rejectLoanByGeneralManager(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    return this.updateLoanStatus(
      id,
      LoanStatus.REJECTED,
      review,
      reviewedByUserId,
      [LoanStatus.LOAN_OFFICER_APPROVED],
      false,
    );
  }

  private async updateLoanStatus(
    id: string,
    nextStatus: LoanStatus,
    review: ReviewLoanDto,
    reviewedByUserId: string,
    allowedFromStatuses: LoanStatus[],
    setReviewingOfficer: boolean,
  ) {
    const existingLoan = await this.prisma.loan.findUnique({
      where: { id },
    });

    if (!existingLoan) {
      throw new NotFoundException('Loan not found');
    }

    if (!allowedFromStatuses.includes(existingLoan.status)) {
      throw new BadRequestException(
        `Loan cannot be moved from ${existingLoan.status} to ${nextStatus}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.loanStatusLog.create({
        data: {
          loanId: existingLoan.id,
          fromStatus: existingLoan.status,
          toStatus: nextStatus,
          changedBy: reviewedByUserId,
          note: review.note,
        },
      });

      await tx.loan.update({
        where: { id: existingLoan.id },
        data: {
          status: nextStatus,
          ...(setReviewingOfficer ? { userId: reviewedByUserId } : {}),
          activatedAt: nextStatus === LoanStatus.APPROVED ? new Date() : null,
        },
      });
    }, LOAN_STATUS_TRANSACTION_OPTIONS);

    const loan = await this.findLoanForReviewResponse(existingLoan.id);

    if (nextStatus === LoanStatus.APPROVED) {
      await this.generateAndAttachLoanContractPdf(loan.id, reviewedByUserId);

      await this.notificationsService.notifyLoanOfficerLoanApproved({
        loanId: loan.id,
        amount: loan.amount,
        clientName: this.getClientDisplayName(loan.client),
        loanOfficerEmail: loan.user?.email,
        loanOfficerName: loan.user?.name,
      });

      await this.disburseMomoLoan(loan.id);
    }

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
        withLoanNumber(loan),
      ])
    )[0];
  }

  private findLoanForReviewResponse(id: string) {
    return this.prisma.loan.findUniqueOrThrow({
      where: { id },
      include: {
        client: {
          include: {
            individual: true,
            business: true,
          },
        },
        user: true,
        statusLogs: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });
  }

  private async createClientLoanRequestInternal(
    data: ClientLoanRequestDto,
    client: { id: string; phoneNumber: string },
    createdByUserId: string,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
  ) {
    const loanId = randomUUID();
    const calculation = this.calculateClientLoanRequest(data.amount);
    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.LOAN,
      ownerId: loanId,
      files,
      uploadedByUserId: createdByUserId,
    });

    try {
      const loan = await this.prisma.$transaction(async (tx) => {
        const createdLoan = await tx.loan.create({
          data: {
            id: loanId,
            clientId: client.id,
            amount: data.amount,
            currency: data.currency,
            totalRepaidAmount: 0,
            outstandingBalance: calculation.repaymentAmountPerMonth,
            purpose: CLIENT_LOAN_PURPOSE,
            interestRatePercentPerMonth:
              CLIENT_LOAN_INTEREST_RATE_PERCENT_PER_MONTH,
            termInMonths: CLIENT_LOAN_TERM_IN_MONTHS,
            termStartDate: calculation.termStartDate,
            termEndDate: calculation.termEndDate,
            disbursementWithinDays: CLIENT_LOAN_DISBURSEMENT_WITHIN_DAYS,
            collateralType: CLIENT_LOAN_COLLATERAL_TYPE,
            collateralEstimatedValue: 0,
            collateralLocation: CLIENT_LOAN_COLLATERAL_LOCATION,
            repaymentInstallmentsCount:
              calculation.repaymentTerms.installmentsCount,
            repaymentAmountPerMonth: calculation.repaymentAmountPerMonth,
            repaymentPeriodMonths: calculation.repaymentTerms.periodMonths,
            paymentDayOfMonth: calculation.paymentDayOfMonth,
            loanProcessingFeePercent: CLIENT_LOAN_FEE_PERCENT,
            administrativeFeePercent: CLIENT_LOAN_FEE_PERCENT,
            loanApplicationFeePercent: CLIENT_LOAN_FEE_PERCENT,
            earlyRepaymentFeePercent: CLIENT_LOAN_FEE_PERCENT,
            defaultPenaltyFeePercentPerDay: CLIENT_LOAN_FEE_PERCENT,
            repaymentTerms: calculation.repaymentTerms as Prisma.InputJsonValue,
            termsAccepted: data.termsAccepted,
            termsVersion: data.termsVersion,
            disbursementMethod: data.disbursementMethod,
            source: LoanSource.CLIENT_ONLINE,
            status: LoanStatus.PENDING,
          },
          include: {
            client: {
              include: {
                individual: true,
                business: true,
              },
            },
            user: true,
            statusLogs: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        });

        await this.documentsService.createMany(preparedDocuments, tx);

        return createdLoan;
      });

      await this.notificationsService.notifyLoanOfficersLoanPendingReview({
        loanId: loan.id,
        amount: loan.amount,
        purpose: loan.purpose,
        clientName: this.getClientDisplayName(loan.client),
      });

      return this.serializeClientLoanRequest(loan, client.phoneNumber);
    } catch (error) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
  }

  private async createLoanInternal(
    data: CreateLoanDto,
    clientId: string,
    createdByUserId: string,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }>,
    initialStatus: LoanStatus,
    assignedLoanOfficerId: string | null,
  ) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    const loanId = randomUUID();
    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.LOAN,
      ownerId: loanId,
      labels: data.documentLabels,
      files,
      uploadedByUserId: createdByUserId,
    });

    try {
      const loan = await this.prisma.$transaction(async (tx) => {
        const createdLoan = await tx.loan.create({
          data: {
            id: loanId,
            clientId,
            amount: data.amount,
            totalRepaidAmount: 0,
            outstandingBalance: data.amount,
            purpose: data.purpose,
            interestRatePercentPerMonth: data.interestRatePercentPerMonth,
            termInMonths: data.termInMonths,
            termStartDate: data.termStartDate,
            termEndDate: data.termEndDate,
            disbursementWithinDays: data.disbursementWithinDays,
            collateralType: data.collateralType,
            collateralEstimatedValue: data.collateralEstimatedValue,
            collateralLocation: data.collateralLocation,
            repaymentInstallmentsCount: data.repaymentInstallmentsCount,
            repaymentAmountPerMonth: data.repaymentAmountPerMonth,
            repaymentPeriodMonths: data.repaymentPeriodMonths,
            paymentDayOfMonth: data.paymentDayOfMonth,
            loanProcessingFeePercent: data.loanProcessingFeePercent,
            administrativeFeePercent: data.administrativeFeePercent,
            loanApplicationFeePercent: data.loanApplicationFeePercent,
            earlyRepaymentFeePercent: data.earlyRepaymentFeePercent,
            defaultPenaltyFeePercentPerDay: data.defaultPenaltyFeePercentPerDay,
            spouseName: data.spouseName,
            repaymentTerms:
              data.repaymentTerms as unknown as Prisma.InputJsonValue,
            guarantorInfo: data.guarantorInfo as
              | Prisma.InputJsonValue
              | undefined,
            comments: data.comments,
            source: LoanSource.STAFF_MANUAL,
            status: initialStatus,
            userId: assignedLoanOfficerId,
          },
          include: {
            client: {
              include: {
                individual: true,
                business: true,
              },
            },
            user: true,
            statusLogs: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          },
        });

        await this.documentsService.createMany(preparedDocuments, tx);

        return createdLoan;
      });

      if (initialStatus === LoanStatus.PENDING) {
        await this.notificationsService.notifyLoanOfficersLoanPendingReview({
          loanId: loan.id,
          amount: loan.amount,
          purpose: loan.purpose,
          clientName: this.getClientDisplayName(loan.client),
        });
      }

      return (
        await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
          withLoanNumber(loan),
        ])
      )[0];
    } catch (error) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
  }

  private calculateClientLoanRequest(amount: number) {
    const termStartDate = this.getCurrentRwandaDateOnly();
    const termEndDate = this.addUtcDays(
      this.addUtcMonthsClamped(termStartDate, CLIENT_LOAN_TERM_IN_MONTHS),
      -1,
    );
    const paymentDayOfMonth = termEndDate.getUTCDate();
    const interestAmount = this.roundCurrencyAmount(
      amount *
        (CLIENT_LOAN_INTEREST_RATE_PERCENT_PER_MONTH / 100) *
        CLIENT_LOAN_TERM_IN_MONTHS,
    );
    const repaymentAmountPerMonth = this.roundCurrencyAmount(
      amount + interestAmount,
    );

    return {
      termStartDate,
      termEndDate,
      paymentDayOfMonth,
      repaymentAmountPerMonth,
      repaymentTerms: {
        currency: CLIENT_LOAN_CURRENCY,
        installmentsCount: CLIENT_LOAN_TERM_IN_MONTHS,
        amountPerInstallment: repaymentAmountPerMonth,
        periodMonths: CLIENT_LOAN_TERM_IN_MONTHS,
        paymentDayOfMonth,
        schedule: [
          {
            installmentNo: 1,
            dueDate: this.formatDateOnly(termEndDate),
            amount: repaymentAmountPerMonth,
          },
        ],
      },
    };
  }

  private serializeClientLoanRequest(
    loan: {
      id: string;
      amount: number;
      currency: string;
      purpose: string;
      status: LoanStatus;
      interestRatePercentPerMonth: number;
      termInMonths: number;
      termStartDate: Date;
      termEndDate: Date;
      paymentDayOfMonth: number;
      repaymentAmountPerMonth: number;
      repaymentTerms: Prisma.JsonValue;
      disbursementMethod: DisbursementMethod;
      outstandingBalance: number;
      createdAt: Date;
      updatedAt: Date;
    },
    disbursementPhone: string,
  ) {
    const normalizedStatus = this.normalizeLoanStatus(
      loan.status,
      loan.outstandingBalance,
      loan.repaymentTerms,
    );

    return {
      data: {
        id: loan.id,
        loanNumber: formatLoanNumber(loan),
        amount: loan.amount,
        currency: loan.currency,
        purpose: loan.purpose,
        status: normalizedStatus,
        workflowStatus: loan.status,
        totalRepayment: loan.repaymentAmountPerMonth,
        interest: this.roundCurrencyAmount(
          loan.repaymentAmountPerMonth - loan.amount,
        ),
        interestRatePercentPerMonth: loan.interestRatePercentPerMonth,
        termInMonths: loan.termInMonths,
        termStartDate: this.formatDateOnly(loan.termStartDate),
        termEndDate: this.formatDateOnly(loan.termEndDate),
        paymentDayOfMonth: loan.paymentDayOfMonth,
        repaymentAmountPerMonth: loan.repaymentAmountPerMonth,
        repaymentTerms: loan.repaymentTerms,
        disbursementMethod: loan.disbursementMethod,
        disbursementPhone: this.maskPhoneNumber(disbursementPhone),
        createdAt: loan.createdAt.toISOString(),
        updatedAt: loan.updatedAt.toISOString(),
      },
    };
  }

  private normalizeLoanStatus(
    status: LoanStatus,
    outstandingBalance: number,
    repaymentTerms: Prisma.JsonValue,
  ): ClientFacingLoanStatus {
    if (
      status === LoanStatus.REJECTED ||
      status === LoanStatus.LOAN_OFFICER_REJECTED
    ) {
      return 'rejected';
    }

    if (
      status === LoanStatus.PENDING ||
      status === LoanStatus.LOAN_OFFICER_APPROVED
    ) {
      return 'pending';
    }

    if (status === LoanStatus.APPROVED) {
      if (outstandingBalance <= 0) {
        return 'completed';
      }

      if (this.isLoanOverdue(repaymentTerms)) {
        return 'overdue';
      }

      return 'active';
    }

    return 'pending';
  }

  private isLoanOverdue(repaymentTerms: Prisma.JsonValue) {
    const schedule =
      (repaymentTerms as { schedule?: Array<{ dueDate: string }> })?.schedule ??
      [];
    const now = new Date();

    return schedule.some((item) => {
      const dueDate = new Date(item.dueDate);
      return dueDate.getTime() < now.getTime();
    });
  }

  private async getClientInfo(clientUserId: string) {
    await this.ensureClientAccountIsActive(clientUserId);

    const client = await this.prisma.client.findUnique({
      where: { userId: clientUserId },
      select: { id: true, phoneNumber: true },
    });

    if (!client) {
      throw new NotFoundException('Client profile not found for this account');
    }

    return client;
  }

  async getClientLoanOffer(clientUserId: string) {
    const client = await this.getClientInfo(clientUserId);

    return {
      availableLimit: CLIENT_LOAN_OFFER_AVAILABLE_LIMIT,
      minimumRequest: CLIENT_LOAN_OFFER_MINIMUM_REQUEST,
      currency: CLIENT_LOAN_CURRENCY,
      interestRatePercent: CLIENT_LOAN_INTEREST_RATE_PERCENT_PER_MONTH,
      termMonths: CLIENT_LOAN_TERM_IN_MONTHS,
      termsVersion: CLIENT_LOAN_TERMS_VERSION,
      disbursementMethod: DisbursementMethod.MOBILE_MONEY,
      disbursementPhone: this.maskPhoneNumber(client.phoneNumber),
      expectedReviewHours: CLIENT_LOAN_OFFER_REVIEW_HOURS,
    };
  }

  async findMyLoansForClient(
    clientUserId: string,
    page = 1,
    limit = 10,
    status?: string,
  ) {
    const client = await this.getClientInfo(clientUserId);

    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.LoanWhereInput = {
      clientId: client.id,
    };

    if (status) {
      const normalized = status.toLowerCase();
      if (normalized === 'pending') {
        where.status = {
          in: [LoanStatus.PENDING, LoanStatus.LOAN_OFFICER_APPROVED],
        };
      } else if (normalized === 'rejected') {
        where.status = {
          in: [LoanStatus.REJECTED, LoanStatus.LOAN_OFFICER_REJECTED],
        };
      } else if (
        normalized === 'active' ||
        normalized === 'completed' ||
        normalized === 'overdue'
      ) {
        where.status = LoanStatus.APPROVED;
      }
    }

    const loans = await this.prisma.loan.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        client: {
          include: {
            individual: true,
            business: true,
          },
        },
        user: true,
        statusLogs: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    const filteredLoans = status
      ? loans.filter(
          (loan) =>
            this.normalizeLoanStatus(
              loan.status,
              loan.outstandingBalance,
              loan.repaymentTerms,
            ) === status.toLowerCase(),
        )
      : loans;

    const total = filteredLoans.length;
    const paginatedLoans = filteredLoans.slice(skip, skip + safeLimit);
    const attachedLoans = await this.documentsService.attachDocuments(
      DocumentOwnerType.LOAN,
      paginatedLoans,
    );

    return {
      data: attachedLoans.map((loan) => this.serializeClientLoanListItem(loan)),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findMyLoanDetailForClient(clientUserId: string, loanId: string) {
    const client = await this.getClientInfo(clientUserId);

    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        repayments: {
          orderBy: {
            paymentDate: 'asc',
          },
        },
        statusLogs: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!loan || loan.clientId !== client.id) {
      throw new NotFoundException('Loan not found');
    }

    return this.serializeClientLoanDetail(loan);
  }

  async getClientLoanDashboard(clientUserId: string) {
    const client = await this.getClientInfo(clientUserId);

    const loans = await this.prisma.loan.findMany({
      where: { clientId: client.id },
      orderBy: { createdAt: 'desc' },
      include: {
        repayments: {
          orderBy: {
            paymentDate: 'asc',
          },
        },
        statusLogs: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    const normalizedLoans = loans.map((loan) => ({
      loan,
      normalizedStatus: this.normalizeLoanStatus(
        loan.status,
        loan.outstandingBalance,
        loan.repaymentTerms,
      ),
    }));

    const activeLoans = normalizedLoans.filter(
      (entry) => entry.normalizedStatus === 'active',
    );

    const nextPaymentDate = activeLoans
      .map((entry) => this.getLoanNextPayment(entry.loan))
      .filter(
        (
          payment,
        ): payment is { dueDate: Date; amount: number; status: string } =>
          Boolean(payment),
      )
      .map((payment) => payment.dueDate)
      .sort((a, b) => a.getTime() - b.getTime())[0];

    const daysRemaining = nextPaymentDate
      ? Math.max(
          0,
          Math.ceil(
            (nextPaymentDate.getTime() - new Date().getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    return {
      activeLoan: activeLoans.reduce(
        (sum, entry) => sum + entry.loan.amount,
        0,
      ),
      outstandingBalance: activeLoans.reduce(
        (sum, entry) => sum + entry.loan.outstandingBalance,
        0,
      ),
      nextPaymentDate: nextPaymentDate
        ? nextPaymentDate.toISOString().slice(0, 10)
        : null,
      daysRemaining,
      loansCount: loans.length,
      recentLoans: loans.slice(0, 3).map((loan) => ({
        id: loan.id,
        loanNumber: formatLoanNumber(loan),
        amount: loan.amount,
        currency: loan.currency,
        status: this.normalizeLoanStatus(
          loan.status,
          loan.outstandingBalance,
          loan.repaymentTerms,
        ),
        workflowStatus: loan.status,
        createdAt: loan.createdAt.toISOString(),
      })),
    };
  }

  private getLoanNextPayment(loan: {
    repaymentTerms: Prisma.JsonValue;
  }): { dueDate: Date; amount: number; status: string } | null {
    const schedule =
      (
        loan.repaymentTerms as {
          schedule?: Array<{ dueDate: string; amount: number }>;
        }
      )?.schedule ?? [];
    if (!schedule.length) {
      return null;
    }

    const items = schedule
      .map((item) => ({
        dueDate: new Date(item.dueDate),
        amount: item.amount,
      }))
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

    const now = new Date();
    const next = items.find((item) => item.dueDate.getTime() >= now.getTime());
    const candidate = next ?? items[items.length - 1];

    return {
      dueDate: candidate.dueDate,
      amount: candidate.amount,
      status:
        candidate.dueDate.getTime() < now.getTime() ? 'overdue' : 'pending',
    };
  }

  private serializeClientLoanListItem(loan: {
    id: string;
    amount: number;
    currency: string;
    purpose: string;
    status: LoanStatus;
    outstandingBalance: number;
    repaymentAmountPerMonth: number;
    repaymentTerms: Prisma.JsonValue;
    createdAt: Date;
  }) {
    const normalizedStatus = this.normalizeLoanStatus(
      loan.status,
      loan.outstandingBalance,
      loan.repaymentTerms,
    );
    const nextPayment = this.getLoanNextPayment(loan);

    return {
      id: loan.id,
      loanNumber: formatLoanNumber(loan),
      amount: loan.amount,
      currency: loan.currency,
      purpose: loan.purpose,
      status: normalizedStatus,
      workflowStatus: loan.status,
      remainingBalance: loan.outstandingBalance,
      totalPayable: loan.repaymentAmountPerMonth,
      interest: this.roundCurrencyAmount(
        loan.repaymentAmountPerMonth - loan.amount,
      ),
      nextPayment: nextPayment
        ? {
            dueDate: this.formatDateOnly(nextPayment.dueDate),
            amount: nextPayment.amount,
            status: nextPayment.status,
          }
        : null,
      createdAt: loan.createdAt.toISOString(),
    };
  }

  private serializeClientLoanDetail(loan: {
    id: string;
    amount: number;
    currency: string;
    purpose: string;
    status: LoanStatus;
    outstandingBalance: number;
    repaymentAmountPerMonth: number;
    repaymentTerms: Prisma.JsonValue;
    repayments: Array<{
      id: string;
      amountPaid: number;
      paymentDate: Date;
      notes: string | null;
      status: RepaymentStatus;
    }>;
    statusLogs: Array<{
      id: string;
      note: string | null;
      createdAt: Date;
    }>;
    createdAt: Date;
  }) {
    const normalizedStatus = this.normalizeLoanStatus(
      loan.status,
      loan.outstandingBalance,
      loan.repaymentTerms,
    );

    const approvedRepayments = loan.repayments.filter(
      (repayment) => repayment.status === RepaymentStatus.APPROVED,
    );
    const repaymentSchedule = this.formatRepaymentSchedule(
      loan.repaymentTerms,
      approvedRepayments,
    );

    return {
      id: loan.id,
      loanNumber: formatLoanNumber(loan),
      amount: loan.amount,
      currency: loan.currency,
      purpose: loan.purpose,
      status: normalizedStatus,
      workflowStatus: loan.status,
      trackerStep: this.getLoanTrackerStep(normalizedStatus),
      interest: this.roundCurrencyAmount(
        loan.repaymentAmountPerMonth - loan.amount,
      ),
      totalPayable: loan.repaymentAmountPerMonth,
      remainingBalance: loan.outstandingBalance,
      repaymentSchedule,
      paymentHistory: this.formatRepaymentHistory(loan.repayments),
      officerNotes: loan.statusLogs
        .filter((log) => Boolean(log.note))
        .map((log) => ({
          id: log.id,
          message: log.note ?? '',
          createdAt: log.createdAt.toISOString(),
        })),
    };
  }

  private formatRepaymentSchedule(
    repaymentTerms: Prisma.JsonValue,
    repayments: Array<{ amountPaid: number; paymentDate: Date }>,
  ) {
    const schedule =
      (
        repaymentTerms as {
          schedule?: Array<{
            installmentNo?: number;
            dueDate: string;
            amount: number;
          }>;
        }
      )?.schedule ?? [];
    const sortedRepayments = [...repayments].sort(
      (a, b) => a.paymentDate.getTime() - b.paymentDate.getTime(),
    );

    return schedule.map((item) => {
      const dueDate = new Date(item.dueDate);
      const isPaid = sortedRepayments.some(
        (repayment) => repayment.paymentDate.getTime() <= dueDate.getTime(),
      );

      return {
        installmentNo: item.installmentNo,
        dueDate: item.dueDate,
        amount: item.amount,
        status: isPaid
          ? 'Paid'
          : dueDate.getTime() < new Date().getTime()
            ? 'Overdue'
            : 'Pending',
      };
    });
  }

  private formatRepaymentHistory(
    repayments: Array<{
      id: string;
      amountPaid: number;
      paymentDate: Date;
      notes: string | null;
      status: RepaymentStatus;
    }>,
  ) {
    return repayments
      .slice()
      .sort((a, b) => b.paymentDate.getTime() - a.paymentDate.getTime())
      .map((repayment) => ({
        paidAt: repayment.paymentDate.toISOString(),
        amount: repayment.amountPaid,
        method: 'Mobile Money',
        reference: repayment.notes ?? repayment.id,
        status: repayment.status,
      }));
  }

  private getLoanTrackerStep(status: ClientFacingLoanStatus) {
    switch (status) {
      case 'pending':
        return 'Application';
      case 'active':
      case 'overdue':
        return 'Repayment';
      case 'completed':
        return 'Completed';
      case 'rejected':
        return 'Rejected';
      default:
        return 'Application';
    }
  }

  private getCurrentRwandaDateOnly(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: RWANDA_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const dateParts = new Map(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );

    return new Date(
      Date.UTC(
        dateParts.get('year') ?? now.getUTCFullYear(),
        (dateParts.get('month') ?? now.getUTCMonth() + 1) - 1,
        dateParts.get('day') ?? now.getUTCDate(),
      ),
    );
  }

  private addUtcMonthsClamped(date: Date, months: number) {
    const targetMonthIndex = date.getUTCMonth() + months;
    const targetYear =
      date.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
    const lastDayOfTargetMonth = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();

    return new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        Math.min(date.getUTCDate(), lastDayOfTargetMonth),
      ),
    );
  }

  private addUtcDays(date: Date, days: number) {
    const nextDate = new Date(date);
    nextDate.setUTCDate(nextDate.getUTCDate() + days);
    return nextDate;
  }

  private roundCurrencyAmount(amount: number) {
    return Math.round(amount);
  }

  private maskPhoneNumber(phoneNumber: string) {
    const digits = phoneNumber.replace(/\D/g, '');
    let localNumber = digits;

    if (digits.startsWith('250') && digits.length === 12) {
      localNumber = `0${digits.slice(3)}`;
    } else if (digits.startsWith('7') && digits.length === 9) {
      localNumber = `0${digits}`;
    }

    if (localNumber.length < 4) {
      return 'XXXX XXX XXX';
    }

    return `${localNumber.slice(0, 4)} XXX XXX`;
  }

  private getClientDisplayName(client: {
    individual?: { fullName: string } | null;
    business?: { businessName: string } | null;
  }) {
    return (
      client.individual?.fullName ?? client.business?.businessName ?? 'Client'
    );
  }

  private async generateAndAttachLoanContractPdf(
    loanId: string,
    uploadedByUserId: string,
  ) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        client: {
          include: {
            individual: true,
            business: true,
          },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found for contract generation');
    }

    const [englishPdfBuffer, kinyarwandaPdfBuffer] = await Promise.all([
      this.buildContractPdf(loan),
      this.buildContractPdfKinyarwanda(loan),
    ]);

    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.LOAN,
      ownerId: loan.id,
      labels: [
        'Loan Contract (English PDF)',
        'Amasezerano y’Inguzanyo (Kinyarwanda PDF)',
      ],
      files: [
        {
          buffer: englishPdfBuffer,
          originalname: `loan-contract-en-${loan.id}.pdf`,
          mimetype: 'application/pdf',
          size: englishPdfBuffer.length,
        },
        {
          buffer: kinyarwandaPdfBuffer,
          originalname: `loan-contract-rw-${loan.id}.pdf`,
          mimetype: 'application/pdf',
          size: kinyarwandaPdfBuffer.length,
        },
      ],
      uploadedByUserId,
    });

    try {
      await this.documentsService.createMany(preparedDocuments, this.prisma);
    } catch (error) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
  }

  private buildContractPdf(loan: {
    id: string;
    amount: number;
    purpose: string;
    interestRatePercentPerMonth: number;
    termInMonths: number;
    termStartDate: Date;
    termEndDate: Date;
    disbursementWithinDays: number;
    collateralType: string;
    collateralEstimatedValue: number;
    collateralLocation: string;
    repaymentInstallmentsCount: number;
    repaymentAmountPerMonth: number;
    repaymentPeriodMonths: number;
    paymentDayOfMonth?: number;
    loanProcessingFeePercent?: number;
    administrativeFeePercent?: number;
    loanApplicationFeePercent?: number;
    earlyRepaymentFeePercent: number;
    defaultPenaltyFeePercentPerDay: number;
    spouseName: string | null;
    client: {
      email: string;
      phoneNumber: string;
      address: string;
      individual?: {
        fullName: string;
        nationalId: string;
        dateOfBirth: Date;
        nationality: string | null;
        maritalStatus: string | null;
        occupation: string | null;
        employerName: string | null;
      } | null;
      business?: {
        businessName: string;
        registrationNumber: string;
      } | null;
    };
  }): Promise<Buffer> {
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN = 50;
    const HEADER_H = 100;
    const FOOTER_H = 100;
    const CONTENT_TOP = HEADER_H + 12;
    const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 10;
    const CONTENT_W = PAGE_W - 2 * MARGIN;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        autoFirstPage: false,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let y = CONTENT_TOP;

      const drawPageChrome = () => {
        const headerPath = join(process.cwd(), 'assets', 'contract_header.png');
        const footerPath = join(process.cwd(), 'assets', 'contracy_footer.png');
        doc.image(headerPath, 0, 0, { width: PAGE_W });
        doc.image(footerPath, 0, PAGE_H - FOOTER_H, { width: PAGE_W });
        doc.fillColor('black');
      };

      const newPage = () => {
        doc.addPage({ size: 'A4', margin: 0 });
        drawPageChrome();
        y = CONTENT_TOP;
      };

      const checkBreak = (needed = 18) => {
        if (y + needed > CONTENT_BOTTOM) newPage();
      };

      const writeLine = (
        content: string,
        opts: {
          bold?: boolean;
          fontSize?: number;
          indent?: number;
          align?: 'left' | 'center' | 'right';
          underline?: boolean;
          gap?: number;
        } = {},
      ) => {
        const {
          bold = false,
          fontSize = 10,
          indent = 0,
          align = 'left',
          underline = false,
          gap = 5,
        } = opts;
        checkBreak(fontSize + gap + 4);
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(fontSize)
          .fillColor('black')
          .text(content, MARGIN + indent, y, {
            width: CONTENT_W - indent,
            align,
            underline,
            lineBreak: true,
          });
        y = doc.y + gap;
      };

      const writeBoldLabelLine = (
        label: string,
        content: string,
        opts: {
          fontSize?: number;
          indent?: number;
          gap?: number;
        } = {},
      ) => {
        const { fontSize = 10, indent = 0, gap = 5 } = opts;
        checkBreak(fontSize + gap + 6);
        const x = MARGIN + indent;
        const yStart = y;
        const width = CONTENT_W - indent;

        doc
          .font('Helvetica-Bold')
          .fontSize(fontSize)
          .fillColor('black')
          .text(label, x, yStart, {
            width,
            continued: true,
          })
          .font('Helvetica')
          .text(content, { lineBreak: true });

        y = doc.y + gap;
      };

      const gap = (h = 8) => {
        checkBreak(h);
        y += h;
      };

      const sectionHeading = (roman: string, title: string) => {
        gap(10);
        checkBreak(22);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('black')
          .text(`${roman}.   ${title}`, MARGIN, y, { width: CONTENT_W });
        y = doc.y + 8;
      };

      const bullet = (content: string, indent = 30) => {
        checkBreak(18);
        doc.circle(MARGIN + indent, y + 4, 2).fill('black');
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('black')
          .text(content, MARGIN + indent + 8, y, {
            width: CONTENT_W - indent - 8,
          });
        y = doc.y + 4;
      };

      const today = this.formatDateOnly(new Date());
      const borrowerName =
        loan.client.individual?.fullName ??
        loan.client.business?.businessName ??
        '................................';
      const borrowerId =
        loan.client.individual?.nationalId ??
        loan.client.business?.registrationNumber ??
        '................................';
      const dob = loan.client.individual
        ? this.formatDateOnly(loan.client.individual.dateOfBirth)
        : '';
      const nationality = loan.client.individual?.nationality ?? '';
      const maritalStatus = loan.client.individual?.maritalStatus ?? '';
      const occupation = loan.client.individual?.occupation ?? '';
      const employerAddress = loan.client.individual?.employerName ?? '';
      const startDate = this.formatDateOnly(loan.termStartDate);
      const endDate = this.formatDateOnly(loan.termEndDate);

      // ── PAGE 1: CLIENT'S IDENTIFICATION ──────────────────────────
      newPage();
      gap(20);
      writeLine("CLIENT'S IDENTIFICATION", {
        bold: true,
        fontSize: 12,
        align: 'center',
        underline: true,
        gap: 20,
      });

      const idFields: [number, string, string][] = [
        [1, 'Full Name', borrowerName],
        [2, 'Date of Birth', dob],
        [3, 'Nationality', nationality],
        [4, 'Residential Address', loan.client.address],
        [5, 'Marital Status', maritalStatus],
        [6, 'Occupation', occupation],
        [7, "Employer's Address", employerAddress],
        [8, 'Contact Number', loan.client.phoneNumber],
        [9, 'Email Address', loan.client.email],
        [10, 'Identification Number (ID)', borrowerId],
        [11, 'Passport Number (If applicable)', ''],
      ];

      for (const [num, label, value] of idFields) {
        writeLine(`${num}.  ${label}: ${value}`, { gap: 8 });
      }

      // ── PAGE 2: LOAN AGREEMENT ─────────────────────────────────────
      newPage();
      gap(12);
      writeLine('LOAN AGREEMENT', {
        bold: true,
        fontSize: 12,
        align: 'center',
        underline: true,
        gap: 14,
      });

      writeLine(`This Loan Agreement ("Agreement") is made on ${today}`, {
        gap: 12,
      });
      writeLine('BETWEEN', { bold: true, align: 'center', gap: 8 });
      writeLine(
        `${borrowerName} (Client's Full Name) residing at ${loan.client.address}`,
        { gap: 6 },
      );
      writeLine(
        `Identification Number: ${borrowerId} (Client's ID Number) hereinafter referred to as the "Borrower"`,
        { gap: 12 },
      );
      writeLine('AND', { bold: true, align: 'center', gap: 8 });
      writeLine(
        'GREEN FINANCING INCORPORATE LTD (GFI LTD), a company registered under the laws of Rwanda, with its registered address at Rusororo, GASABO and having registration number 126361983, represented in this agreement by ................................................ (Name and Title of Company Representative).',
        { gap: 12 },
      );

      writeLine('Background:', { bold: true, gap: 4 });
      writeLine(
        'GREEN FINANCING INCORPORATE LTD (GFI Ltd). ("Lender") is a non-deposit taking financial services provider registered and operating in Rwanda under the regulation No 65/04/2023 of 25/04/2023. The client has approached the lender for a loan and the lender has agreed to lend him/her on the terms as set out hereunder.',
        { gap: 12 },
      );

      sectionHeading('I', 'LOAN DETAILS:');
      writeBoldLabelLine(
        'a.  Loan Amount:',
        ` The lender agrees to lend the client the principal amount of RWF ${this.formatMoney(loan.amount)}`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        'b.  Interest Rate:',
        ` The loan shall accrue interest at a rate of ${loan.interestRatePercentPerMonth}% per month.`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        'c.  Fees:',
        ` The borrower will pay a loan processing fee of ${loan.loanProcessingFeePercent ?? 0}%, an administration fee of ${loan.administrativeFeePercent ?? 0}%, and a loan application fee of ${loan.loanApplicationFeePercent ?? 0}% based on the approved amount.`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        'd.  Loan Term:',
        ` The loan term shall be ${loan.termInMonths} Months, commencing on ${startDate} (Start Date) and ending on ${endDate} (End Date).`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        'e.  Purpose of Loan:',
        ` The Borrower shall use the Loan solely for ${loan.purpose}`,
        { indent: 15, gap: 5 },
      );

      sectionHeading('II', 'DISBURSEMENT');
      writeLine(
        `a.  The loan amount shall be disbursed to the client's designated bank account after signing this agreement and completion of any required documentation. The loan will be disbursed within ${loan.disbursementWithinDays} Day(s) after the completion of the above-mentioned documents.`,
        { indent: 15, gap: 6 },
      );
      writeLine(
        'b.  The Borrower agrees to provide all necessary documentation and information as requested by the lender for the disbursement of the loan which includes:',
        { indent: 15, gap: 5 },
      );

      bullet('Application Letter');
      bullet('Identification Documents: National ID/Passport');
      bullet("Borrower's Credit History Information (CRB Report)");
      bullet(
        'Collateral Documents (if applicable): Property Title Deeds, Vehicle Registration, Valuation report of the property, etc.',
      );
      bullet('Any other documents deemed necessary.');

      newPage();
      sectionHeading('III', 'COLLATERAL DESCRIPTION:');
      writeLine(`a.  Collateral Type: ${loan.collateralType}`, {
        indent: 15,
        gap: 5,
      });
      writeLine(
        `b.  Estimated Value of collateral: RWF ${this.formatMoney(loan.collateralEstimatedValue)}`,
        { indent: 15, gap: 5 },
      );
      writeLine(`c.  Location: ${loan.collateralLocation}`, {
        indent: 15,
        gap: 5,
      });

      sectionHeading('IV', 'REPAYMENT');
      writeLine(
        `a.  The loan shall be repaid by the client in ${loan.repaymentInstallmentsCount} installments of`,
        { indent: 15, gap: 4 },
      );
      bullet(
        `${this.formatMoney(loan.repaymentAmountPerMonth)} RWF (Each Month)`,
        40,
      );
      writeLine(
        `b.  The payment will be made on every month's ${loan.paymentDayOfMonth ? this.toOrdinal(loan.paymentDayOfMonth) : 'N/A'} day for the period of ${loan.repaymentPeriodMonths} Months.`,
        { indent: 15, gap: 5 },
      );

      sectionHeading('V', 'EARLY REPAYMENT:');
      writeLine(
        `The borrower reserves the right to prepay the outstanding loan balance at any time without incurring any prepayment penalties. However, in case the loan is transferred to another financial institution, the early repayment fee of ${loan.earlyRepaymentFeePercent}% shall be charged on the outstanding balance.`,
        { gap: 5 },
      );

      sectionHeading('VI', 'DEFAULT');
      writeLine(
        'a.  In the absence of any payment from the borrower, he/she will be in default.',
        { indent: 15, gap: 5 },
      );
      writeLine('b.  The client breaks any term of this agreement.', {
        indent: 15,
        gap: 5,
      });
      writeLine(
        `c.  In case of late payment, a late fee/penalty of ${loan.defaultPenaltyFeePercentPerDay}% shall be charged each day on the overdue amount.`,
        { indent: 15, gap: 5 },
      );
      writeLine(
        'd.  Upon default, the lender reserves the right to pursue all available legal remedies to recover the outstanding loan amount, including but not limited to, debt collection agencies, legal action, and seizure of collateral if applicable and all costs associated with maintaining, insuring, or recovering shall be borne by the client without further ado.',
        { indent: 15, gap: 5 },
      );

      sectionHeading('VII', 'GOVERNING LAW:');

      writeLine(
        'This agreement shall be governed by and construed in accordance with the laws of Republic of Rwanda.',
        { gap: 5 },
      );

      sectionHeading('VIII', 'DISPUTE RESOLUTION');
      writeLine(
        'Any disputes arising out of or in connection with this agreement shall be resolved through amicable negotiations between the parties. If the parties fail to reach a resolution, the dispute shall be referred to arbitration in accordance with the laws of Rwanda.',
        { gap: 5 },
      );

      newPage();
      sectionHeading('IX', 'MISCELLANEOUS');
      writeLine(
        'This agreement constitutes the entire agreement between the parties concerning the subject matter hereof and supersedes all prior agreements and understandings, whether written or oral.',
        { gap: 14 },
      );

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('black')
        .text('IN WITNESS WHEREOF,', MARGIN, y, {
          continued: true,
          underline: false,
        })
        .font('Helvetica')
        .text(
          `The parties have executed this agreement as of the date ${today}`,
          { lineBreak: true },
        );
      y = doc.y + 14;

      writeLine('BORROWER', { bold: true, underline: true, gap: 8 });
      writeLine(
        "Borrower's Signature: ____________________________     Date: ...... / ........ / ........",
        { gap: 8 },
      );
      writeLine(`Full Names: ${borrowerName}`, { gap: 20 });

      writeLine('LENDER', { bold: true, underline: true, gap: 8 });
      writeLine(
        "Lender's Signature: ______________________________     Date: ...... / ........ / ........",
        { gap: 8 },
      );
      writeLine("Company Representative's Name: ____________________________", {
        gap: 8,
      });
      writeLine('Stamp:', { gap: 5 });

      writeLine('NOTARY', { bold: true, underline: true, gap: 8 });
      writeLine(
        'Signature: ____________________________                    Date: ...... / ........ / ........',
        { gap: 8 },
      );
      writeLine('Name: ____________________________', { gap: 25 });

      writeLine('SPOUSE CONSENT (IF APPLICABLE)', {
        bold: true,
        underline: true,
        fontSize: 11,
        align: 'center',
        gap: 10,
      });
      const spouseRef =
        loan.spouseName ?? '....................................';
      writeLine(
        `I, ${spouseRef} Spouse of ${borrowerName} (Client's Full Name), hereby acknowledge and consent to the execution of this loan contract agreement by ${borrowerName} (Client's Full Name) with GREEN FINANCING INCORPORATE LTD (GFI Ltd). I understand the terms and conditions of the loan as outlined above and confirm that I have no objection to ${borrowerName} (Client's Full Name) entering into this agreement.`,
        { gap: 14 },
      );
      writeLine('Signature:', { bold: true, gap: 8 });
      writeLine('Date: ...... / ........ / ..........', { bold: true, gap: 5 });

      doc.end();
    });
  }

  private buildContractPdfKinyarwanda(loan: {
    id: string;
    amount: number;
    purpose: string;
    interestRatePercentPerMonth: number;
    termInMonths: number;
    termStartDate: Date;
    termEndDate: Date;
    disbursementWithinDays: number;
    collateralType: string;
    collateralEstimatedValue: number;
    collateralLocation: string;
    repaymentInstallmentsCount: number;
    repaymentAmountPerMonth: number;
    repaymentPeriodMonths: number;
    paymentDayOfMonth?: number;
    loanProcessingFeePercent?: number;
    administrativeFeePercent?: number;
    loanApplicationFeePercent?: number;
    earlyRepaymentFeePercent: number;
    defaultPenaltyFeePercentPerDay: number;
    spouseName: string | null;
    client: {
      email: string;
      phoneNumber: string;
      address: string;
      individual?: {
        fullName: string;
        nationalId: string;
        dateOfBirth: Date;
        nationality: string | null;
        maritalStatus: string | null;
        occupation: string | null;
        employerName: string | null;
      } | null;
      business?: {
        businessName: string;
        registrationNumber: string;
      } | null;
    };
  }): Promise<Buffer> {
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN = 50;
    const HEADER_H = 100;
    const FOOTER_H = 100;
    const CONTENT_TOP = HEADER_H + 12;
    const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 10;
    const CONTENT_W = PAGE_W - 2 * MARGIN;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 0,
        autoFirstPage: false,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      let y = CONTENT_TOP;

      const drawPageChrome = () => {
        const headerPath = join(process.cwd(), 'assets', 'contract_header.png');
        const footerPath = join(process.cwd(), 'assets', 'contracy_footer.png');
        doc.image(headerPath, 0, 0, { width: PAGE_W });
        doc.image(footerPath, 0, PAGE_H - FOOTER_H, { width: PAGE_W });
        doc.fillColor('black');
      };

      const newPage = () => {
        doc.addPage({ size: 'A4', margin: 0 });
        drawPageChrome();
        y = CONTENT_TOP;
      };

      const checkBreak = (needed = 18) => {
        if (y + needed > CONTENT_BOTTOM) newPage();
      };

      const writeLine = (
        content: string,
        opts: {
          bold?: boolean;
          fontSize?: number;
          indent?: number;
          align?: 'left' | 'center' | 'right';
          underline?: boolean;
          gap?: number;
        } = {},
      ) => {
        const {
          bold = false,
          fontSize = 10,
          indent = 0,
          align = 'left',
          underline = false,
          gap = 5,
        } = opts;
        checkBreak(fontSize + gap + 4);
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(fontSize)
          .fillColor('black')
          .text(content, MARGIN + indent, y, {
            width: CONTENT_W - indent,
            align,
            underline,
            lineBreak: true,
          });
        y = doc.y + gap;
      };
      const writeBoldLabelLine = (
        label: string,
        content: string,
        opts: {
          fontSize?: number;
          indent?: number;
          gap?: number;
        } = {},
      ) => {
        const { fontSize = 10, indent = 0, gap = 5 } = opts;
        checkBreak(fontSize + gap + 6);
        const x = MARGIN + indent;
        const yStart = y;
        const width = CONTENT_W - indent;

        doc
          .font('Helvetica-Bold')
          .fontSize(fontSize)
          .fillColor('black')
          .text(label, x, yStart, {
            width,
            continued: true,
          })
          .font('Helvetica')
          .text(content, { lineBreak: true });

        y = doc.y + gap;
      };

      const gap = (h = 8) => {
        checkBreak(h);
        y += h;
      };

      const sectionHeading = (roman: string, title: string) => {
        gap(10);
        checkBreak(22);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor('black')
          .text(`${roman}.   ${title}`, MARGIN, y, { width: CONTENT_W });
        y = doc.y + 8;
      };

      const bullet = (content: string, indent = 30) => {
        checkBreak(18);
        doc.circle(MARGIN + indent, y + 4, 2).fill('black');
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('black')
          .text(content, MARGIN + indent + 8, y, {
            width: CONTENT_W - indent - 8,
          });
        y = doc.y + 4;
      };

      const today = this.formatDateOnly(new Date());
      const borrowerName =
        loan.client.individual?.fullName ??
        loan.client.business?.businessName ??
        '................................';
      const borrowerId =
        loan.client.individual?.nationalId ??
        loan.client.business?.registrationNumber ??
        '................................';
      const dob = loan.client.individual
        ? this.formatDateOnly(loan.client.individual.dateOfBirth)
        : '';
      const nationality = loan.client.individual?.nationality ?? '';
      const maritalStatus = loan.client.individual?.maritalStatus ?? '';
      const occupation = loan.client.individual?.occupation ?? '';
      const employerAddress = loan.client.individual?.employerName ?? '';
      const startDate = this.formatDateOnly(loan.termStartDate);
      const endDate = this.formatDateOnly(loan.termEndDate);

      // ── PAGE 1: CLIENT'S IDENTIFICATION ──────────────────────────
      newPage();
      gap(20);
      writeLine("UMWIRONDORO W'USABA INGUZANYO", {
        bold: true,
        fontSize: 12,
        align: 'center',
        underline: true,
        gap: 20,
      });

      const idFields: [number, string, string][] = [
        [1, 'Amazina Yombi', borrowerName],
        [2, 'Itariki wavukiyeho', dob],
        [3, 'Ubwenegihugu', nationality],
        [4, 'Aho utuye', loan.client.address],
        [5, 'Irangamimere', maritalStatus],
        [6, 'Umwuga', occupation],
        [7, "Aderesi y'Umukoresha wawe", employerAddress],
        [8, "Nomero yawe y'Itumanaho", loan.client.phoneNumber],
        [9, 'Aderesi ya Imeri', loan.client.email],
        [10, "Nomero y'indangamuntu (ID)", borrowerId],
        [11, 'Nomero ya Pasiporo (Niba ari ngombwa)', ''],
      ];

      for (const [num, label, value] of idFields) {
        writeLine(`${num}.  ${label}: ${value}`, { gap: 8 });
      }

      // ── PAGE 2: LOAN AGREEMENT ─────────────────────────────────────
      newPage();
      gap(12);
      writeLine("AMASEZERANO Y'INGUZANYO", {
        bold: true,
        fontSize: 12,
        align: 'center',
        underline: true,
        gap: 14,
      });

      writeLine(
        `Aya masezerano y'inguzanyo ("Amasezerano") yakozwe ku itariki ${today}`,
        {
          gap: 12,
        },
      );
      writeLine('HAGATI', { bold: true, align: 'center', gap: 8 });
      writeLine(
        `${borrowerName} (Amazina y'usaba inguzanyo), utuye ${loan.client.address}`,
        { gap: 6 },
      );
      writeLine(`Ufite nomero y'indangamuntu: ${borrowerId}`, { gap: 12 });
      writeLine('NA', { bold: true, align: 'center', gap: 8 });
      writeLine(
        `GREEN FINANCING INCORPORATE LTD (GFI LTD), isosiyete yanditswe hakurikijwe amategeko y'u Rwanda, ifite aderesi yayo i Rusororo, GASABO kandi ifite nomero iyiranga 126361983, ihagarariwe muri aya masezerano na ................................................ (Izina ry'uhagarariye GREEN FINANCING INCORPORATE LTD (GFI Ltd)).`,
        { gap: 12 },
      );

      writeLine(`Amavu n'amavuko`, { bold: true, gap: 4 });
      writeLine(
        `GREEN FINANCING INCORPORATE LTD (GFI Ltd). (“Ugurije”) ni sosiyete itanga serivisi z’imari itakira amafaranga abitswa yiyandikishije kandi ikorera mu Rwanda hakurikijwe amabwiriza No 65/04/2023 yo kuwa 25/04/2023. Ugurijwe yegereye utanze inguzanyo/ugurije asaba inguzanyo kandi uwatanze inguzanyo yemeye kumuguriza ku masezerano nk'uko bigaragara hano.`,
        { gap: 12 },
      );

      sectionHeading('I', `IBISOBANURO BY'INGUZANYO:`);
      writeBoldLabelLine(
        `a. Umubare w'inguzanyo:`,
        `Utanze inguzanyo yemeye kuguriza umukiriya inguzanyo ingana na RWF ${this.formatMoney(loan.amount)}`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        `b. Igipimo cy'inyungu:`,
        `Inguzanyo izunguka inyungu ku gipimo cya ${loan.interestRatePercentPerMonth}% buri kwezi.`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        `c. Umufuragiro:`,
        `Ugurijwe azishyura amafaranga yo gutunganya inguzanyo angana na ${loan.loanProcessingFeePercent ?? 0}%, amafaranga y’ubuyobozi angana na ${loan.administrativeFeePercent ?? 0}%, n’amafaranga yo gusaba inguzanyo angana na ${loan.loanApplicationFeePercent ?? 0}% abarwa hakurikijwe inguzanyo yemejwe.`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        `d. Igihe cy'inguzanyo:`,
        `Inguzanyo izamara  amezi ${loan.termInMonths}, guhera ku itariki ${startDate} kugeza ku itariki ${endDate}.`,
        { indent: 15, gap: 5 },
      );
      writeBoldLabelLine(
        `e. Intego y'inguzanyo:`,
        `Uwagurikwe azakoresha Inguzanyo gusa mu ${loan.purpose}`,
        { indent: 15, gap: 5 },
      );

      sectionHeading('II', 'GUTANGA INGUZANYO');
      writeLine(
        `a. Inguzanyo igomba gutangwa k’ugurijwe kuri konti ya banki yagenwe nyuma yo gushyira umukono kuri aya masezerano no kuzuza ibyangombwa byose bisabwa. Inguzanyo izatangwa mu minsi ${loan.disbursementWithinDays} nyuma yo kuzuza ibyangombwa byavuzwe haruguru.`,
        { indent: 15, gap: 6 },
      );
      writeLine(
        'b. Ugurijwe yemeye gutanga ibyangombwa byose n’amakuru nkuko byasabwe n’ugurije kugirango atange inguzanyo. Ibikubiyemo: ',
        { indent: 15, gap: 5 },
      );

      bullet('Ibaruwa isaba inguzanyo');
      bullet(`Indangamuntu y'igihugu cyangwa pasiporo`);
      bullet("Icyangombwa cyerekana amakuru k'umyenda (Raporo ya CRB)");
      bullet(
        'Inyandiko z’ingwate (niba ari ngombwa): Icyangombwa cy’ubutaka, Icyangombwa cy’ikinyabiziga, Raporo y’agaciro k’ingwate,n’ibindi.',
      );
      newPage();
      bullet('Izindi nyandiko zose zisabwa bibaye ngombwa.');

      sectionHeading('III', `IBISOBANURO BY'INGWATE:`);
      writeLine(`a. Ubwoko bw'ingwate: ${loan.collateralType}`, {
        indent: 15,
        gap: 5,
      });
      writeLine(
        `b. Agaciro kagereranijwe k'ingwate: RWF ${this.formatMoney(loan.collateralEstimatedValue)}`,
        { indent: 15, gap: 5 },
      );
      writeLine(`c. Aho iherereye: ${loan.collateralLocation}`, {
        indent: 15,
        gap: 5,
      });

      sectionHeading('IV', 'KWISHYURWA');
      writeLine(
        `a. Inguzanyo izishyurwa n’ugurijwe mu bice ${loan.repaymentInstallmentsCount} bigabanyijwe:`,
        { indent: 15, gap: 4 },
      );
      bullet(
        `${this.formatMoney(loan.repaymentAmountPerMonth)} RWF (Buri kwezi)`,
        40,
      );
      writeLine(
        `b. Ubwishyu buzakorwa buri kwezi tariki ${loan.paymentDayOfMonth ? this.toOrdinal(loan.paymentDayOfMonth) : 'N/A'} mugihe cy'amezi ${loan.repaymentPeriodMonths}.`,
        { indent: 15, gap: 5 },
      );

      sectionHeading('V', `KWISHYURA MBERE Y'IGIHE`);
      writeLine(
        `Uwagurijwe afite uburenganzira bwo kwishyura mbere y’inguzanyo isigaye igihe icyo ari cyo cyose nta gihano cyo kwishyura mbere. Ariko, mugihe inguzanyo yimuriwe mu kindi kigo cy’imari, amafaranga yo kwishyura hakiri kare angana na ${loan.earlyRepaymentFeePercent}% (ku nguzanyo isigaye).`,
        { gap: 5 },
      );

      sectionHeading('VI', 'MBURABUZI/KUNANIRWA KWISHYURA');
      writeLine(
        `a. Mugihe hatabayeho kwishyurira igihe n’uwagurijwe, azafatwa nk’uwananiwe kwishyura.`,
        { indent: 15, gap: 5 },
      );
      writeLine(`b. Umukiriya arenga ingingo ayo ari yo yose y’amasezerano.`, {
        indent: 15,
        gap: 5,
      });
      writeLine(
        `c. Mugihe habaye gutinda kwishyura, umufuragiro ungana na ${loan.defaultPenaltyFeePercentPerDay}% yishyurwa buri munsi k’umafaranga yarengeje igihe.`,
        { indent: 15, gap: 5 },
      );
      writeLine(
        `d. Iyo bitubahirijwe, uwatanze inguzanyo afite uburenganzira bwo gukurikirana uburyo bwose bwemewe n'amategeko bwo kugaruza amafaranga y’inguzanyo asigaye, harimo kugana bishinzwe gukusanya imyenda, kurega mu nkiko, no gufatira ingwate niba bibaye ngombwa.  n’amafaranga yose ajyanye no kubungabunga, kwishingira, cyangwa kugaruza inguzanyo bizishyurwa n’ugurijwe nta yandi mananiza.`,
        { indent: 15, gap: 5 },
      );

      sectionHeading('VII', 'AMATEGEKO AGENGA AMASEZERANO');

      writeLine(
        `Aya masezerano agengwa kandi agasobanurwa hakurikijwe amategeko ya Repubulika y'u Rwanda.`,
        { gap: 5 },
      );

      sectionHeading('VIII', 'GUKEMURA AMAKIMBIRANE');
      writeLine(
        `Amakimbirane ayo ari yo yose akomoka cyangwa ajyanye n’amasezerano agomba gukemurwa binyuze mu mishyikirano y’ubwumvikane hagati y’impande zombi. Niba impande zombi zinaniwe gufata umwanzuro, amakimbirane yoherezwa mu bukemurampaka hakurikijwe amategeko y'u Rwanda.`,
        { gap: 5 },
      );

      newPage();
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('black')
        .text('MU BUHAMYA AHO, ', MARGIN, y, {
          continued: true,
          underline: false,
        })
        .font('Helvetica')
        .text(
          `Uwagurijwe n’ Uwagurije bashyize mu bikorwa aya masezerano guhera ku itariki ${today}`,
          { lineBreak: true },
        );
      y = doc.y + 14;

      writeLine('UGURIJWE', { bold: true, underline: true, gap: 8 });
      writeLine(
        "Umukono w'Ugurijwe: ____________________________     Itariki: ...... / ........ / ........",
        { gap: 8 },
      );
      writeLine(`Amazina yose: ${borrowerName}`, { gap: 20 });

      writeLine('UGURIJE', { bold: true, underline: true, gap: 8 });
      writeLine(
        "Umukono w'Ugurije: ______________________________     Itariki: ...... / ........ / ........",
        { gap: 8 },
      );
      writeLine("Izina ry'uhagarariye sosiyete: ____________________________", {
        gap: 8,
      });
      writeLine('Kashe:', { gap: 5 });

      writeLine('NOTERI', { bold: true, underline: true, gap: 8 });
      writeLine(
        'Umukono: ____________________________                    Itariki: ...... / ........ / ........',
        { gap: 8 },
      );
      writeLine('Amazina: ____________________________', { gap: 25 });

      writeLine(`UMWANZURO W'UBWEMERE KU BANTU BASHYINGIRANYWE`, {
        bold: true,
        underline: true,
        fontSize: 11,
        align: 'center',
        gap: 10,
      });
      const spouseRef =
        loan.spouseName ?? '....................................';
      writeLine(
        `Nyewe, ${spouseRef} Umugore/Umugabo wa ${borrowerName} (Amazina y'uwo mwashyingiranywe). Ndemeranya kandi nemera gushyira mu bikorwa aya masezerano y’inguzanyo hagati y’uwo twashakanye ariwe ${borrowerName} hamwe na GREEN FINANCING INCORPORATE LTD (GFI Ltd). Ndumva amategeko n'amabwiriza y'inguzanyo nkuko byavuzwe haruguru kandi nemeza ko nta nzitizi mfite kuri ${borrowerName} (Amazina y'uwo mwashyingiranywe) ryinjira muri aya masezerano.`,
        { gap: 14 },
      );
      writeLine('Umukono:', { bold: true, gap: 8 });
      writeLine('Itariki: ...... / ........ / ..........', {
        bold: true,
        gap: 5,
      });

      doc.end();
    });
  }

  private formatDateOnly(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private formatMoney(amount: number) {
    return new Intl.NumberFormat('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    }).format(amount);
  }

  private toOrdinal(day: number) {
    const mod100 = day % 100;
    if (mod100 >= 11 && mod100 <= 13) {
      return `${day}th`;
    }

    switch (day % 10) {
      case 1:
        return `${day}st`;
      case 2:
        return `${day}nd`;
      case 3:
        return `${day}rd`;
      default:
        return `${day}th`;
    }
  }

  async retryDisbursement(loanId: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      select: { id: true, status: true, disbursementReference: true },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    if (loan.status !== LoanStatus.APPROVED) {
      throw new BadRequestException(
        'Disbursement can only be retried for approved loans',
      );
    }

    // Clear the old reference so disburseMomoLoan will proceed
    await this.prisma.loan.update({
      where: { id: loanId },
      data: { disbursementReference: null },
    });

    await this.disburseMomoLoan(loanId);

    return this.findOne(loanId);
  }

  async disburseMomoLoan(loanId: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        client: { include: { individual: true, business: true } },
      },
    });

    if (!loan) {
      this.logger.error(`disburseMomoLoan: loan ${loanId} not found`);
      return;
    }

    if (loan.disbursementMethod !== DisbursementMethod.MOBILE_MONEY) {
      return;
    }

    if (loan.disbursementReference) {
      this.logger.warn(
        `disburseMomoLoan: loan ${loanId} already has disbursementReference`,
      );
      return;
    }

    try {
      const { referenceId } = await this.momoDisbursements.transfer({
        amount: loan.amount,
        currency: loan.currency,
        phoneNumber: loan.client.phoneNumber,
        externalId: loan.id,
        payerMessage: `GFI Rwanda loan disbursement`,
        payeeNote: `Loan amount: ${loan.amount} ${loan.currency}`,
      });

      await this.prisma.loan.update({
        where: { id: loan.id },
        data: { disbursementReference: referenceId },
      });

      this.logger.log(
        `MoMo disbursement initiated for loan ${loanId}, referenceId: ${referenceId}`,
      );
    } catch (error) {
      this.logger.error(
        `MoMo disbursement failed for loan ${loanId}: ${(error as Error).message}`,
      );
    }
  }

  async handleMomoDisbursementCallback(referenceId: string, status: string) {
    const loan = await this.prisma.loan.findUnique({
      where: { disbursementReference: referenceId },
      include: {
        client: { include: { individual: true, business: true } },
      },
    });

    if (!loan) {
      this.logger.warn(
        `MoMo disbursement callback: no loan found for reference ${referenceId}`,
      );
      return;
    }

    if (status === 'SUCCESSFUL') {
      this.logger.log(
        `MoMo disbursement SUCCESSFUL for loan ${loan.id}, reference ${referenceId}`,
      );
    } else if (status === 'FAILED') {
      this.logger.error(
        `MoMo disbursement FAILED for loan ${loan.id}, reference ${referenceId}. Staff review required.`,
      );

      await this.notificationsService.notifyGeneralManagersDisbursementFailed({
        loanId: loan.id,
        amount: loan.amount,
        clientName: this.getClientDisplayName(loan.client),
        phoneNumber: loan.client.phoneNumber,
        disbursementReference: referenceId,
      });
    }
  }
}
