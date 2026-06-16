jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));

jest.mock('../momo/momo-disbursements.service', () => ({
  MomoDisbursementsService: class MomoDisbursementsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { DocumentsService } from '../documents/documents.service';
import { MomoDisbursementsService } from '../momo/momo-disbursements.service';
import {
  ClientOnboardingStatus,
  DisbursementMethod,
  DocumentOwnerType,
  LoanSource,
  LoanStatus,
  UserRole,
} from '../generated/prisma/enums';
import { LoansService } from './loans.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';

describe('LoansService', () => {
  let service: LoansService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
    client: {
      findUnique: jest.Mock;
    };
    loan: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
    };
    loanStatusLog: Record<string, never>;
    $transaction: jest.Mock;
  };
  let notificationsService: {
    notifyGeneralManagersLoanPendingApproval: jest.Mock;
    notifyLoanOfficerLoanApproved: jest.Mock;
    notifyLoanOfficersLoanPendingReview: jest.Mock;
  };
  let documentsService: {
    attachDocuments: jest.Mock;
    prepareDocuments: jest.Mock;
    createMany: jest.Mock;
    cleanupPreparedDocuments: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      client: {
        findUnique: jest.fn(),
      },
      loan: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      loanStatusLog: {},
      $transaction: jest.fn(),
    };
    notificationsService = {
      notifyGeneralManagersLoanPendingApproval: jest.fn(),
      notifyLoanOfficerLoanApproved: jest.fn(),
      notifyLoanOfficersLoanPendingReview: jest.fn(),
    };
    documentsService = {
      attachDocuments: jest.fn(),
      prepareDocuments: jest.fn(),
      createMany: jest.fn(),
      cleanupPreparedDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: NotificationsService,
          useValue: notificationsService,
        },
        {
          provide: DocumentsService,
          useValue: documentsService,
        },
        {
          provide: MomoDisbursementsService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a client loan request with backend-calculated repayment terms', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-13T08:30:00.000Z'));

    const createdAt = new Date('2026-05-13T10:30:00.000Z');
    const tx = {
      loan: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            createdAt,
            updatedAt: createdAt,
            client: {
              individual: { fullName: 'Client One' },
              business: null,
            },
            user: null,
            statusLogs: [],
          }),
        ),
      },
    };

    prisma.user.findUnique.mockResolvedValue({
      roles: [UserRole.CLIENT],
      clientOnboardingStatus: ClientOnboardingStatus.ACTIVE,
    });
    prisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      phoneNumber: '0788123456',
    });
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    documentsService.prepareDocuments.mockResolvedValue([]);
    documentsService.createMany.mockResolvedValue([]);

    await expect(
      service.requestLoanAsClient(
        {
          amount: 150000,
          currency: 'RWF',
          termInMonths: 1,
          termsAccepted: true,
          termsVersion: 'loan-request-v1',
          disbursementMethod: DisbursementMethod.MOBILE_MONEY,
        },
        'user-1',
      ),
    ).resolves.toEqual({
      data: {
        id: expect.any(String),
        loanNumber: expect.stringMatching(/^LN-2026-[A-F0-9]{8}$/),
        amount: 150000,
        currency: 'RWF',
        purpose: 'Quick loan application',
        status: 'pending',
        workflowStatus: LoanStatus.PENDING_OFFICER_REVIEW,
        totalRepayment: 165000,
        interest: 15000,
        interestRatePercentPerMonth: 10,
        termInMonths: 1,
        termStartDate: '2026-05-13',
        termEndDate: '2026-06-12',
        paymentDayOfMonth: 12,
        repaymentAmountPerMonth: 165000,
        repaymentTerms: {
          currency: 'RWF',
          installmentsCount: 1,
          amountPerInstallment: 165000,
          periodMonths: 1,
          paymentDayOfMonth: 12,
          schedule: [
            {
              installmentNo: 1,
              dueDate: '2026-06-12',
              amount: 165000,
            },
          ],
        },
        disbursementMethod: DisbursementMethod.MOBILE_MONEY,
        disbursementPhone: '0788 XXX XXX',
        createdAt: '2026-05-13T10:30:00.000Z',
        updatedAt: '2026-05-13T10:30:00.000Z',
      },
    });

    expect(tx.loan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientId: 'client-1',
          amount: 150000,
          outstandingBalance: 165000,
          termsAccepted: true,
          termsVersion: 'loan-request-v1',
          disbursementMethod: DisbursementMethod.MOBILE_MONEY,
          source: LoanSource.CLIENT_ONLINE,
        }),
      }),
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { clientOnboardingStatus: true, roles: true },
    });
    expect(prisma.client.findUnique).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: {
        id: true,
        phoneNumber: true,
      },
    });
    expect(
      notificationsService.notifyLoanOfficersLoanPendingReview,
    ).toHaveBeenCalledWith({
      loanId: expect.any(String),
      amount: 150000,
      purpose: 'Quick loan application',
      clientName: 'Client One',
    });
  });

  it('filters staff loan listing by source', async () => {
    const createdAt = new Date('2026-05-13T10:30:00.000Z');
    const loan = {
      id: 'loan-1',
      createdAt,
      status: LoanStatus.PENDING_OFFICER_REVIEW,
      source: LoanSource.CLIENT_ONLINE,
    };

    prisma.loan.findMany.mockResolvedValue([loan]);
    prisma.loan.count.mockResolvedValue(1);
    documentsService.attachDocuments.mockImplementation((_, loans) =>
      Promise.resolve(loans),
    );

    await expect(
      service.findAll(2, 5, LoanStatus.PENDING_OFFICER_REVIEW, LoanSource.CLIENT_ONLINE),
    ).resolves.toEqual({
      data: [
        {
          ...loan,
          loanNumber: 'LN-2026-LOAN1',
        },
      ],
      meta: {
        page: 2,
        limit: 5,
        total: 1,
        totalPages: 1,
      },
    });

    expect(prisma.loan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: LoanStatus.PENDING_OFFICER_REVIEW,
          source: LoanSource.CLIENT_ONLINE,
        },
        skip: 5,
        take: 5,
      }),
    );
    expect(prisma.loan.count).toHaveBeenCalledWith({
      where: {
        status: LoanStatus.PENDING_OFFICER_REVIEW,
        source: LoanSource.CLIENT_ONLINE,
      },
    });
    expect(documentsService.attachDocuments).toHaveBeenCalledWith(
      DocumentOwnerType.LOAN,
      [
        {
          ...loan,
          loanNumber: 'LN-2026-LOAN1',
        },
      ],
    );
  });
});
