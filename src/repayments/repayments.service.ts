import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ClientOnboardingStatus,
  DocumentOwnerType,
  LoanStatus,
  RepaymentSource,
  RepaymentStatus,
  UserRole,
} from '../generated/prisma/enums';
import { DocumentsService } from '../documents/documents.service';
import { MomoCollectionsService } from '../momo/momo-collections.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import { withLoanNumber } from '../loans/loan-number';
import { CreateOnlineRepaymentDto } from './dto/create-online-repayment.dto';
import { CreateRepaymentDto } from './dto/create-repayment.dto';
import { ReviewRepaymentDto } from './dto/review-repayment.dto';

@Injectable()
export class RepaymentsService {
  private readonly logger = new Logger(RepaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
    private readonly momoCollections: MomoCollectionsService,
  ) {}

  async findAll(
    page = 1,
    limit = 10,
    status?: RepaymentStatus,
    source?: RepaymentSource,
  ) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where = {
      ...(status ? { status } : {}),
      ...(source ? { source } : {}),
    };

    const [repayments, total] = await Promise.all([
      this.prisma.repayment.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          loan: {
            select: {
              id: true,
              createdAt: true,
              amount: true,
              outstandingBalance: true,
              totalRepaidAmount: true,
              purpose: true,
              status: true,
              client: {
                include: {
                  individual: true,
                  business: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.repayment.count({ where }),
    ]);

    return {
      data: await this.documentsService.attachDocuments(
        DocumentOwnerType.REPAYMENT,
        repayments.map((repayment) => this.addLoanNumberToRepayment(repayment)),
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
    const repayment = await this.prisma.repayment.findUnique({
      where: { id },
      include: {
        loan: {
          select: {
            id: true,
            createdAt: true,
            amount: true,
            outstandingBalance: true,
            totalRepaidAmount: true,
            purpose: true,
            status: true,
            user: true,
            client: {
              include: {
                individual: true,
                business: true,
              },
            },
          },
        },
      },
    });

    if (!repayment) {
      throw new NotFoundException('Repayment not found');
    }

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.REPAYMENT, [
        this.addLoanNumberToRepayment(repayment),
      ])
    )[0];
  }

  async findMyRepayments(
    clientUserId: string,
    page = 1,
    limit = 10,
    status?: RepaymentStatus,
  ) {
    const client = await this.getActiveClient(clientUserId);

    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where = {
      loan: {
        clientId: client.id,
      },
      ...(status ? { status } : {}),
    };

    const [repayments, total] = await Promise.all([
      this.prisma.repayment.findMany({
        where,
        skip,
        take: safeLimit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          loan: {
            select: {
              id: true,
              createdAt: true,
              amount: true,
              outstandingBalance: true,
              totalRepaidAmount: true,
              purpose: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.repayment.count({ where }),
    ]);

    return {
      data: await this.documentsService.attachDocuments(
        DocumentOwnerType.REPAYMENT,
        repayments.map((repayment) => this.addLoanNumberToRepayment(repayment)),
      ),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findMyRepayment(clientUserId: string, repaymentId: string) {
    const client = await this.getActiveClient(clientUserId);

    const repayment = await this.prisma.repayment.findUnique({
      where: { id: repaymentId },
      include: {
        loan: {
          select: {
            id: true,
            clientId: true,
            createdAt: true,
            amount: true,
            outstandingBalance: true,
            totalRepaidAmount: true,
            purpose: true,
            status: true,
          },
        },
      },
    });

    if (!repayment || repayment.loan.clientId !== client.id) {
      throw new NotFoundException('Repayment not found');
    }

    const { clientId: _clientId, ...loanForResponse } = repayment.loan;

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.REPAYMENT, [
        this.addLoanNumberToRepayment({
          ...repayment,
          loan: loanForResponse,
        }),
      ])
    )[0];
  }

  async createOnlineRepayment(
    loanId: string,
    data: CreateOnlineRepaymentDto,
    clientUserId: string,
  ) {
    const client = await this.getActiveClient(clientUserId);
    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      include: {
        user: true,
        client: {
          include: {
            individual: true,
            business: true,
          },
        },
      },
    });

    if (!loan || loan.clientId !== client.id) {
      throw new NotFoundException('Loan not found');
    }

    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException(
        'Online payment can only be made for active or overdue loans',
      );
    }

    if (loan.outstandingBalance <= 0) {
      throw new BadRequestException('Loan is already fully paid');
    }

    const pendingRepayments = await this.prisma.repayment.aggregate({
      where: {
        loanId: loan.id,
        status: RepaymentStatus.PENDING,
      },
      _sum: {
        amountPaid: true,
      },
    });
    const availableBalance =
      loan.outstandingBalance - (pendingRepayments._sum.amountPaid ?? 0);

    if (data.amountPaid > availableBalance) {
      throw new BadRequestException(
        'Payment amount exceeds outstanding loan balance after pending repayments',
      );
    }

    const repaymentId = randomUUID();
    const referenceId = randomUUID();
    const paymentPhoneNumber =
      data.paymentPhoneNumber?.trim() || client.phoneNumber;

    // Create the repayment record BEFORE calling MoMo so the callback can
    // always find it, even when the sandbox responds within milliseconds.
    const repayment = await this.prisma.repayment.create({
      data: {
        id: repaymentId,
        loanId: loan.id,
        amountPaid: data.amountPaid,
        paymentDate: new Date(),
        notes: this.buildOnlinePaymentNotes(data, referenceId),
        source: RepaymentSource.CLIENT_ONLINE,
        paymentProvider: data.paymentProvider,
        paymentReference: referenceId,
        paymentPhoneNumber,
        status: RepaymentStatus.PENDING,
      },
      include: {
        loan: {
          select: {
            id: true,
            createdAt: true,
            amount: true,
            outstandingBalance: true,
            totalRepaidAmount: true,
            purpose: true,
            status: true,
            user: true,
            client: {
              include: {
                individual: true,
                business: true,
              },
            },
          },
        },
      },
    });

    // Initiate MoMo USSD push after the repayment record exists in the DB,
    // so the callback can always find it regardless of response speed.
    await this.momoCollections.requestToPay({
      amount: data.amountPaid,
      currency: loan.currency,
      phoneNumber: paymentPhoneNumber,
      externalId: repaymentId,
      payerMessage: `Loan repayment for loan ${loan.id}`,
      payeeNote: `GFI Rwanda loan repayment`,
      referenceId,
    });

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.REPAYMENT, [
        this.addLoanNumberToRepayment(repayment),
      ])
    )[0];
  }

  async overrideOnlineRepayment(
    repaymentId: string,
    action: 'approve' | 'reject',
  ) {
    const repayment = await this.prisma.repayment.findUnique({
      where: { id: repaymentId },
      include: {
        loan: {
          include: {
            client: { include: { individual: true, business: true } },
          },
        },
      },
    });

    if (!repayment) {
      throw new NotFoundException('Repayment not found');
    }

    if (repayment.source !== RepaymentSource.CLIENT_ONLINE) {
      throw new BadRequestException(
        'Override is only applicable to online repayments',
      );
    }

    if (repayment.status !== RepaymentStatus.PENDING) {
      throw new BadRequestException(
        `Repayment is already ${repayment.status.toLowerCase()} and cannot be overridden`,
      );
    }

    if (action === 'approve') {
      await this.prisma.$transaction(async (tx) => {
        const loanDeduction = await tx.loan.updateMany({
          where: {
            id: repayment.loanId,
            outstandingBalance: { gte: repayment.amountPaid },
          },
          data: {
            outstandingBalance: { decrement: repayment.amountPaid },
            totalRepaidAmount: { increment: repayment.amountPaid },
          },
        });

        if (loanDeduction.count === 0) {
          throw new BadRequestException(
            'Repayment amount exceeds outstanding loan balance',
          );
        }

        await tx.repayment.update({
          where: { id: repayment.id },
          data: {
            status: RepaymentStatus.APPROVED,
            approvedAt: new Date(),
            notes: [
              repayment.notes,
              'Manually approved by staff (MoMo override).',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        });
      });
    } else {
      await this.prisma.repayment.update({
        where: { id: repayment.id },
        data: {
          status: RepaymentStatus.REJECTED,
          notes: [
            repayment.notes,
            'Manually rejected by staff (MoMo override).',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      });
    }

    return this.findOne(repaymentId);
  }

  async handleMomoCollectionCallback(repaymentId: string, status: string) {
    const repayment = await this.prisma.repayment.findUnique({
      where: { id: repaymentId },
      include: {
        loan: {
          include: {
            client: { include: { individual: true, business: true } },
            user: true,
          },
        },
      },
    });

    if (!repayment) {
      this.logger.warn(
        `MoMo collection callback: no repayment found for id ${repaymentId}`,
      );
      return;
    }

    if (repayment.status !== RepaymentStatus.PENDING) {
      this.logger.warn(
        `MoMo collection callback: repayment ${repayment.id} already in status ${repayment.status}`,
      );
      return;
    }

    if (status === 'SUCCESSFUL') {
      await this.prisma.$transaction(async (tx) => {
        const loanDeduction = await tx.loan.updateMany({
          where: {
            id: repayment.loanId,
            outstandingBalance: { gte: repayment.amountPaid },
          },
          data: {
            outstandingBalance: { decrement: repayment.amountPaid },
            totalRepaidAmount: { increment: repayment.amountPaid },
          },
        });

        if (loanDeduction.count === 0) {
          this.logger.error(
            `MoMo callback: outstanding balance already insufficient for repayment ${repayment.id}`,
          );
          return;
        }

        await tx.repayment.update({
          where: { id: repayment.id },
          data: {
            status: RepaymentStatus.APPROVED,
            approvedAt: new Date(),
          },
        });
      });

      this.logger.log(
        `MoMo collection confirmed: repayment ${repayment.id} approved`,
      );
    } else if (status === 'FAILED') {
      await this.prisma.repayment.update({
        where: { id: repayment.id },
        data: { status: RepaymentStatus.REJECTED },
      });

      this.logger.warn(
        `MoMo collection failed: repayment ${repayment.id} rejected`,
      );
    }
  }

  async createManualRepayment(
    data: CreateRepaymentDto,
    uploadedByUserId: string,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
  ) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: data.loanId },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException(
        'Manual repayment can only be recorded for active loans',
      );
    }

    const { principalPaid, interestPaid } = this.resolveManualSplit(loan, data);

    const repaymentId = randomUUID();
    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.REPAYMENT,
      ownerId: repaymentId,
      labels: data.documentLabels,
      files,
      uploadedByUserId,
    });

    try {
      const repayment = await this.prisma.$transaction(async (tx) => {
        const createdRepayment = await tx.repayment.create({
          data: {
            id: repaymentId,
            loanId: data.loanId,
            amountPaid: data.amountPaid,
            principalPaid,
            interestPaid,
            paymentDate: data.paymentDate,
            notes: data.notes,
            source: RepaymentSource.STAFF_MANUAL,
            status: RepaymentStatus.PENDING,
          },
          include: {
            loan: {
              select: {
                id: true,
                createdAt: true,
                amount: true,
                outstandingBalance: true,
                totalRepaidAmount: true,
                purpose: true,
                status: true,
                user: true,
                client: {
                  include: {
                    individual: true,
                    business: true,
                  },
                },
              },
            },
          },
        });

        await this.documentsService.createMany(preparedDocuments, tx);

        return createdRepayment;
      });

      await this.notificationsService.notifyGeneralManagersRepaymentPendingApproval(
        {
          repaymentId: repayment.id,
          loanId: repayment.loanId,
          amountPaid: repayment.amountPaid,
          paymentDate: repayment.paymentDate,
          clientName: this.getClientDisplayName(repayment.loan.client),
          source: RepaymentSource.STAFF_MANUAL,
        },
      );

      return (
        await this.documentsService.attachDocuments(
          DocumentOwnerType.REPAYMENT,
          [this.addLoanNumberToRepayment(repayment)],
        )
      )[0];
    } catch (error) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
  }

  async approveRepayment(id: string, review: ReviewRepaymentDto) {
    return this.updateRepaymentStatus(id, RepaymentStatus.APPROVED, review);
  }

  async rejectRepayment(id: string, review: ReviewRepaymentDto) {
    return this.updateRepaymentStatus(id, RepaymentStatus.REJECTED, review);
  }

  private async updateRepaymentStatus(
    id: string,
    nextStatus: RepaymentStatus,
    review: ReviewRepaymentDto,
  ) {
    const updatedRepayment = await this.prisma.$transaction(async (tx) => {
      const repayment = await tx.repayment.findUnique({
        where: { id },
      });

      if (!repayment) {
        throw new NotFoundException('Repayment not found');
      }

      if (repayment.status !== RepaymentStatus.PENDING) {
        throw new BadRequestException(
          `Only pending repayments can be ${nextStatus.toLowerCase()}`,
        );
      }

      const noteSuffix = review.note?.trim();
      const nextNotes = [repayment.notes, noteSuffix]
        .filter(Boolean)
        .join('\n');

      if (nextStatus === RepaymentStatus.APPROVED) {
        // outstandingBalance always tracks principal, so it is reduced only by
        // the principal portion. Repayments without a recorded split (e.g.
        // online) fall back to the full amount to preserve prior behavior.
        const principalPortion =
          repayment.principalPaid ?? repayment.amountPaid;

        const loanDeduction = await tx.loan.updateMany({
          where: {
            id: repayment.loanId,
            outstandingBalance: {
              gte: principalPortion,
            },
          },
          data: {
            outstandingBalance: {
              decrement: principalPortion,
            },
            totalRepaidAmount: {
              increment: repayment.amountPaid,
            },
            totalInterestReceived: {
              increment: repayment.interestPaid ?? 0,
            },
            totalPrincipalRecovered: {
              increment: repayment.principalPaid ?? 0,
            },
          },
        });

        if (loanDeduction.count === 0) {
          throw new BadRequestException(
            'Repayment principal exceeds outstanding loan balance',
          );
        }
      }

      await tx.repayment.update({
        where: { id: repayment.id },
        data: {
          status: nextStatus,
          approvedAt:
            nextStatus === RepaymentStatus.APPROVED ? new Date() : null,
          notes: nextNotes || repayment.notes,
        },
      });

      return tx.repayment.findUniqueOrThrow({
        where: { id: repayment.id },
        include: {
          loan: {
            select: {
              id: true,
              createdAt: true,
              amount: true,
              outstandingBalance: true,
              totalRepaidAmount: true,
              purpose: true,
              status: true,
              user: true,
              client: {
                include: {
                  individual: true,
                  business: true,
                },
              },
            },
          },
        },
      });
    });

    if (nextStatus === RepaymentStatus.APPROVED) {
      await this.notificationsService.notifyLoanOfficerRepaymentApproved({
        repaymentId: updatedRepayment.id,
        loanId: updatedRepayment.loanId,
        amountPaid: updatedRepayment.amountPaid,
        clientName: this.getClientDisplayName(updatedRepayment.loan.client),
        loanOfficerEmail: updatedRepayment.loan.user?.email,
        loanOfficerName: updatedRepayment.loan.user?.name,
      });
    }

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.REPAYMENT, [
        this.addLoanNumberToRepayment(updatedRepayment),
      ])
    )[0];
  }

  private async getActiveClient(clientUserId: string) {
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

    const client = await this.prisma.client.findUnique({
      where: { userId: clientUserId },
      select: { id: true, phoneNumber: true },
    });

    if (!client) {
      throw new NotFoundException('Client profile not found for this account');
    }

    return client;
  }

  private normalizePaymentReference(
    paymentReference: string | undefined,
    repaymentId: string,
  ) {
    const trimmed = paymentReference?.trim();
    if (trimmed) {
      return trimmed;
    }

    return `PAY-${repaymentId.slice(0, 8).toUpperCase()}`;
  }

  private buildOnlinePaymentNotes(
    data: CreateOnlineRepaymentDto,
    paymentReference: string,
  ) {
    return [
      data.notes?.trim(),
      `Online payment submitted by client via ${data.paymentProvider}. Reference: ${paymentReference}.`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async ensurePaymentReferenceIsAvailable(paymentReference: string) {
    const existing = await this.prisma.repayment.findUnique({
      where: { paymentReference },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('Payment reference has already been used');
    }
  }

  private addLoanNumberToRepayment<
    T extends { loan: { id: string; createdAt?: Date | string | null } },
  >(repayment: T) {
    const loan = withLoanNumber(repayment.loan);
    const { createdAt: _createdAt, ...loanForResponse } = loan;

    return {
      ...repayment,
      loan: loanForResponse,
    };
  }

  private getClientDisplayName(client: {
    individual?: { fullName: string } | null;
    business?: { businessName: string } | null;
  }) {
    return (
      client.individual?.fullName ?? client.business?.businessName ?? 'Client'
    );
  }

  private roundCurrencyAmount(amount: number) {
    return Math.round(amount);
  }

  /**
   * Declining-balance split for a manual repayment: the payment first settles
   * the interest accrued on the current outstanding principal for one period,
   * and whatever remains reduces the principal. Computed from the loan's live
   * principal balance so early/partial/balloon payments are handled correctly.
   */
  private computeRepaymentSplit(
    outstandingPrincipal: number,
    interestRatePercentPerMonth: number,
    amountPaid: number,
  ): { principalPaid: number; interestPaid: number } {
    const interestDue = this.roundCurrencyAmount(
      outstandingPrincipal * (interestRatePercentPerMonth / 100),
    );
    const interestPaid = Math.min(amountPaid, Math.max(interestDue, 0));
    const principalPaid = this.roundCurrencyAmount(amountPaid - interestPaid);
    return { principalPaid, interestPaid };
  }

  /**
   * Resolves the principal/interest split to store for a manual repayment.
   * When staff supply the split it is validated; when omitted it falls back to
   * the computed declining-balance suggestion. In all cases the two portions
   * must sum exactly to the amount paid and the principal portion cannot exceed
   * the outstanding principal balance.
   */
  private resolveManualSplit(
    loan: { outstandingBalance: number; interestRatePercentPerMonth: number },
    data: { amountPaid: number; principalPaid?: number; interestPaid?: number },
  ): { principalPaid: number; interestPaid: number } {
    const staffProvidedSplit =
      data.principalPaid !== undefined || data.interestPaid !== undefined;

    let principalPaid: number;
    let interestPaid: number;

    if (staffProvidedSplit) {
      // Allow staff to send just one side; the other is the remainder.
      interestPaid =
        data.interestPaid ?? data.amountPaid - (data.principalPaid ?? 0);
      principalPaid =
        data.principalPaid ?? data.amountPaid - (data.interestPaid ?? 0);
    } else {
      ({ principalPaid, interestPaid } = this.computeRepaymentSplit(
        loan.outstandingBalance,
        loan.interestRatePercentPerMonth,
        data.amountPaid,
      ));
    }

    if (principalPaid < 0 || interestPaid < 0) {
      throw new BadRequestException(
        'principalPaid and interestPaid cannot be negative',
      );
    }

    // Tolerate sub-unit rounding only; every franc paid must be allocated.
    if (Math.abs(principalPaid + interestPaid - data.amountPaid) > 0.5) {
      throw new BadRequestException(
        'principalPaid and interestPaid must sum to amountPaid',
      );
    }

    if (principalPaid > loan.outstandingBalance) {
      throw new BadRequestException(
        'principalPaid cannot exceed the outstanding principal balance',
      );
    }

    return { principalPaid, interestPaid };
  }

  /**
   * Returns the suggested principal/interest split for a prospective manual
   * repayment so the staff form can pre-fill the fields. Staff may override the
   * suggestion before submitting.
   */
  async getSuggestedSplit(loanId: string, amount: number) {
    if (!(amount > 0)) {
      throw new BadRequestException('amount must be greater than 0');
    }

    const loan = await this.prisma.loan.findUnique({
      where: { id: loanId },
      select: {
        id: true,
        status: true,
        outstandingBalance: true,
        interestRatePercentPerMonth: true,
      },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    const split = this.computeRepaymentSplit(
      loan.outstandingBalance,
      loan.interestRatePercentPerMonth,
      amount,
    );

    return {
      loanId: loan.id,
      amountPaid: amount,
      outstandingPrincipal: loan.outstandingBalance,
      interestRatePercentPerMonth: loan.interestRatePercentPerMonth,
      ...split,
    };
  }
}
