import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '../generated/prisma/client';
import { DocumentOwnerType, LoanStatus } from '../generated/prisma/enums';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { ReviewLoanDto } from './dto/review-loan.dto';

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly documentsService: DocumentsService,
  ) {}

  async findAll(page = 1, limit = 10, status?: LoanStatus) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where = status ? { status } : undefined;

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
        loans,
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

    return (await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
      loan,
    ]))[0];
  }

  async createLoan(
    data: CreateLoanDto,
    createdByUserId: string,
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string; size: number }> = [],
  ) {
    const client = await this.prisma.client.findUnique({
      where: {
        id: data.clientId,
      },
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
            clientId: data.clientId,
            amount: data.amount,
            purpose: data.purpose,
            repaymentTerms:
              data.repaymentTerms as unknown as Prisma.InputJsonValue,
            guarantorInfo:
              data.guarantorInfo as Prisma.InputJsonValue | undefined,
            comments: data.comments,
            status: LoanStatus.PENDING,
            userId: createdByUserId,
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

      await this.notificationsService.notifyGeneralManagersLoanPendingApproval({
        loanId: loan.id,
        amount: loan.amount,
        purpose: loan.purpose,
        clientName: this.getClientDisplayName(loan.client),
        loanOfficerName: loan.user?.name,
      });

      return (
        await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [loan])
      )[0];
    } catch (error) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
  }

  async approveLoan(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    return this.updateLoanStatus(
      id,
      LoanStatus.APPROVED,
      review,
      reviewedByUserId,
    );
  }

  async rejectLoan(
    id: string,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    return this.updateLoanStatus(
      id,
      LoanStatus.REJECTED,
      review,
      reviewedByUserId,
    );
  }

  private async updateLoanStatus(
    id: string,
    nextStatus: LoanStatus,
    review: ReviewLoanDto,
    reviewedByUserId: string,
  ) {
    const existingLoan = await this.prisma.loan.findUnique({
      where: { id },
    });

    if (!existingLoan) {
      throw new NotFoundException('Loan not found');
    }

    if (existingLoan.status !== LoanStatus.PENDING) {
      throw new BadRequestException(
        `Only pending loans can be ${nextStatus.toLowerCase()}`,
      );
    }

    const loan = await this.prisma.$transaction(async (tx) => {
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
          activatedAt: nextStatus === LoanStatus.APPROVED ? new Date() : null,
        },
      });

      return tx.loan.findUniqueOrThrow({
        where: { id: existingLoan.id },
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
    });

    if (nextStatus === LoanStatus.APPROVED) {
      await this.notificationsService.notifyLoanOfficerLoanApproved({
        loanId: loan.id,
        amount: loan.amount,
        clientName: this.getClientDisplayName(loan.client),
        loanOfficerEmail: loan.user?.email,
        loanOfficerName: loan.user?.name,
      });
    }

    return (await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
      loan,
    ]))[0];
  }

  private getClientDisplayName(client: {
    individual?: { fullName: string } | null;
    business?: { businessName: string } | null;
  }) {
    return (
      client.individual?.fullName ?? client.business?.businessName ?? 'Client'
    );
  }
}
