import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import type { Prisma } from '../generated/prisma/client';
import {
  ClientOnboardingStatus,
  DocumentOwnerType,
  LoanStatus,
  UserRole,
} from '../generated/prisma/enums';
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

  async findMyLoans(
    clientEmail: string,
    page = 1,
    limit = 10,
    status?: LoanStatus,
  ) {
    await this.ensureClientAccountIsActive(clientEmail);

    const client = await this.prisma.client.findUnique({
      where: { email: clientEmail },
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

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
        loan,
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
    data: CreateLoanDto,
    createdByUserId: string,
    clientEmail: string,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
  ) {
    await this.ensureClientAccountIsActive(clientEmail);

    const client = await this.prisma.client.findUnique({
      where: { email: clientEmail },
      select: { id: true },
    });

    if (!client) {
      throw new NotFoundException('Client profile not found for this account');
    }

    return this.createLoanInternal(
      data,
      client.id,
      createdByUserId,
      files,
      LoanStatus.PENDING,
      null,
    );
  }

  private async ensureClientAccountIsActive(clientEmail: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: clientEmail },
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
    const loan = await this.prisma.$transaction(async (tx) => {
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

    await this.generateAndAttachLoanContractPdf(loan.id, reviewedByUserId);

    await this.notificationsService.notifyLoanOfficerLoanApproved({
      loanId: loan.id,
      amount: loan.amount,
      clientName: this.getClientDisplayName(loan.client),
      loanOfficerEmail: loan.user?.email,
      loanOfficerName: loan.user?.name,
    });

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
        loan,
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
          ...(setReviewingOfficer ? { userId: reviewedByUserId } : {}),
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
      await this.generateAndAttachLoanContractPdf(loan.id, reviewedByUserId);

      await this.notificationsService.notifyLoanOfficerLoanApproved({
        loanId: loan.id,
        amount: loan.amount,
        clientName: this.getClientDisplayName(loan.client),
        loanOfficerEmail: loan.user?.email,
        loanOfficerName: loan.user?.name,
      });
    }

    return (
      await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
        loan,
      ])
    )[0];
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
          loan,
        ])
      )[0];
    } catch (error) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      throw error;
    }
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
}
