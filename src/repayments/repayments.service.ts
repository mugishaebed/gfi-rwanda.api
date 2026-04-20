import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LoanStatus, RepaymentStatus } from '../generated/prisma/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';
import { CreateRepaymentDto } from './dto/create-repayment.dto';
import { ReviewRepaymentDto } from './dto/review-repayment.dto';

@Injectable()
export class RepaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(page = 1, limit = 10, status?: RepaymentStatus) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where = status ? { status } : undefined;

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
            include: {
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
      data: repayments,
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
          include: {
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

    return repayment;
  }

  async createManualRepayment(data: CreateRepaymentDto) {
    const loan = await this.prisma.loan.findUnique({
      where: { id: data.loanId },
    });

    if (!loan) {
      throw new NotFoundException('Loan not found');
    }

    if (loan.status !== LoanStatus.APPROVED) {
      throw new BadRequestException(
        'Manual repayment can only be recorded for approved loans',
      );
    }

    const repayment = await this.prisma.repayment.create({
      data: {
        loanId: data.loanId,
        amountPaid: data.amountPaid,
        paymentDate: data.paymentDate,
        notes: data.notes,
        status: RepaymentStatus.PENDING,
      },
      include: {
        loan: {
          include: {
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

    await this.notificationsService.notifyGeneralManagersRepaymentPendingApproval(
      {
        repaymentId: repayment.id,
        loanId: repayment.loanId,
        amountPaid: repayment.amountPaid,
        paymentDate: repayment.paymentDate,
        clientName: this.getClientDisplayName(repayment.loan.client),
      },
    );

    return repayment;
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
    const repayment = await this.prisma.repayment.findUnique({
      where: { id },
      include: {
        loan: {
          include: {
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

    if (repayment.status !== RepaymentStatus.PENDING) {
      throw new BadRequestException(
        `Only pending repayments can be ${nextStatus.toLowerCase()}`,
      );
    }

    const noteSuffix = review.note?.trim();
    const nextNotes = [repayment.notes, noteSuffix].filter(Boolean).join('\n');

    const updatedRepayment = await this.prisma.repayment.update({
      where: { id: repayment.id },
      data: {
        status: nextStatus,
        approvedAt: nextStatus === RepaymentStatus.APPROVED ? new Date() : null,
        notes: nextNotes || repayment.notes,
      },
      include: {
        loan: {
          include: {
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

    return updatedRepayment;
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
