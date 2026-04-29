import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import PDFDocument from 'pdfkit';
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
        await this.documentsService.attachDocuments(DocumentOwnerType.LOAN, [
          loan,
        ])
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

    const pdfBuffer = await this.buildContractPdf(loan);
    const fileName = `loan-contract-${loan.id}.pdf`;

    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.LOAN,
      ownerId: loan.id,
      labels: ['Loan Contract (Generated PDF)'],
      files: [
        {
          buffer: pdfBuffer,
          originalname: fileName,
          mimetype: 'application/pdf',
          size: pdfBuffer.length,
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
    const GFI_GREEN = '#1BC463';
    const LOGO_GREEN = '#158A48';
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN = 50;
    const HEADER_H = 75;
    const FOOTER_H = 45;
    const CONTENT_TOP = HEADER_H + 22;
    const CONTENT_BOTTOM = PAGE_H - FOOTER_H - 15;
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
        doc.rect(0, 0, PAGE_W, HEADER_H).fill(GFI_GREEN);
        doc.rect(0, 0, 190, HEADER_H).fill(LOGO_GREEN);

        doc
          .fillColor('white')
          .font('Helvetica-Bold')
          .fontSize(26)
          .text('GF', 12, 16, { lineBreak: false });
        doc.rect(48, 10, 1, 55).fill('rgba(255,255,255,0.6)');
        doc
          .fillColor('white')
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .text('GREEN', 54, 20, { lineBreak: false });
        doc.text('FINANCING', 54, 31, { lineBreak: false });
        doc.text('INCORPORATE Ltd', 54, 42, { lineBreak: false });

        doc
          .fillColor('white')
          .font('Helvetica')
          .fontSize(9)
          .text('☎  0788306937', 210, 20, { lineBreak: false })
          .text('●  Kigali, RWANDA', 210, 35, { lineBreak: false })
          .text('@  info@gfi-rwanda.com', 210, 50, { lineBreak: false });

        doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H).fill(GFI_GREEN);
        doc
          .fillColor('white')
          .font('Helvetica-BoldOblique')
          .fontSize(11)
          .text(
            'Finance for a Better Planet, Progress for All."',
            MARGIN,
            PAGE_H - FOOTER_H + 14,
            {
              width: CONTENT_W,
              lineBreak: false,
            },
          );
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
        [8, "Employer's Address", ''],
        [9, 'Contact Number', loan.client.phoneNumber],
        [10, 'Email Address', loan.client.email],
        [11, 'Identification Number (ID)', borrowerId],
        [12, 'Passport Number (If applicable)', ''],
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
      writeLine(
        `a.  Loan Amount: The lender agrees to lend the client the principal amount of RWF ${this.formatMoney(loan.amount)}`,
        { indent: 15, gap: 5 },
      );
      writeLine(
        `b.  Interest Rate: The loan shall accrue interest at a rate of ${loan.interestRatePercentPerMonth}% per month.`,
        { indent: 15, gap: 5 },
      );
      writeLine(
        `c.  Fees: The borrower will pay a loan processing fee of ${loan.loanProcessingFeePercent ?? 0}%, an administration fee of ${loan.administrativeFeePercent ?? 0}%, and a loan application fee of ${loan.loanApplicationFeePercent ?? 0}% based on the approved amount.`,
        { indent: 15, gap: 5 },
      );
      writeLine(
        `d.  Loan Term: The loan term shall be ${loan.termInMonths} Months, commencing on ${startDate} (Start Date) and ending on ${endDate} (End Date).`,
        { indent: 15, gap: 5 },
      );
      writeLine(
        `e.  Purpose of Loan: The Borrower shall use the Loan solely for ${loan.purpose}`,
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

      // ── PAGE 4: REPAYMENT + EARLY REPAYMENT + DEFAULT + GOV LAW ───
      newPage();
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

      sectionHeading('IX', 'MISCELLANEOUS');
      writeLine(
        'This agreement constitutes the entire agreement between the parties concerning the subject matter hereof and supersedes all prior agreements and understandings, whether written or oral.',
        { gap: 14 },
      );

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('black')
        .text('IN WITNESS WHEREOF, ', MARGIN, y, {
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

      // ── PAGE 6: NOTARY + SPOUSE CONSENT ───────────────────────────
      newPage();
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
