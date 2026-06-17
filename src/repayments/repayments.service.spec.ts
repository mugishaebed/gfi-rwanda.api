jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));

jest.mock('../momo/momo-collections.service', () => ({
  MomoCollectionsService: class MomoCollectionsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { MomoCollectionsService } from '../momo/momo-collections.service';
import {
  ClientOnboardingStatus,
  DocumentOwnerType,
  LoanStatus,
  OnlinePaymentProvider,
  RepaymentSource,
  RepaymentStatus,
  UserRole,
} from '../generated/prisma/enums';
import { DocumentsService } from '../documents/documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RepaymentsService } from './repayments.service';
import { PrismaService } from '../prisma.service';

describe('RepaymentsService', () => {
  let service: RepaymentsService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
    };
    client: {
      findUnique: jest.Mock;
    };
    repayment: {
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
    loan: {
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let notificationsService: {
    notifyGeneralManagersRepaymentPendingApproval: jest.Mock;
    notifyLoanOfficerRepaymentApproved: jest.Mock;
  };
  let documentsService: {
    attachDocuments: jest.Mock;
  };
  let momoCollections: {
    requestToPay: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      client: {
        findUnique: jest.fn(),
      },
      repayment: {
        findMany: jest.fn(),
        count: jest.fn(),
        aggregate: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      loan: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    notificationsService = {
      notifyGeneralManagersRepaymentPendingApproval: jest.fn(),
      notifyLoanOfficerRepaymentApproved: jest.fn(),
    };
    documentsService = {
      attachDocuments: jest.fn(),
    };
    momoCollections = {
      requestToPay: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepaymentsService,
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
          useValue: {
            attachDocuments: documentsService.attachDocuments,
            prepareDocuments: jest.fn(),
            createMany: jest.fn(),
            cleanupPreparedDocuments: jest.fn(),
          },
        },
        {
          provide: MomoCollectionsService,
          useValue: momoCollections,
        },
      ],
    }).compile();

    service = module.get<RepaymentsService>(RepaymentsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('manual repayment principal/interest split', () => {
    const activeManualLoan = (overrides = {}) => ({
      id: 'loan-1',
      status: LoanStatus.ACTIVE,
      outstandingBalance: 200_000_000,
      interestRatePercentPerMonth: 7,
      amount: 200_000_000,
      client: { individual: { fullName: 'Client One' }, business: null },
      user: null,
      ...overrides,
    });

    const setupManualCreate = () => {
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn(prisma),
      );
      prisma.repayment.create.mockImplementation(({ data }: { data: any }) =>
        Promise.resolve({
          ...data,
          createdAt: new Date('2026-06-05T08:00:00.000Z'),
          loan: {
            id: 'loan-1',
            amount: 200_000_000,
            outstandingBalance: 200_000_000,
            totalRepaidAmount: 0,
            purpose: 'Working capital',
            status: LoanStatus.ACTIVE,
            user: null,
            client: { individual: { fullName: 'Client One' }, business: null },
          },
        }),
      );
      documentsService.attachDocuments.mockImplementation(
        (_: unknown, r: unknown) => Promise.resolve(r),
      );
    };

    it('suggests an interest-first declining-balance split', async () => {
      prisma.loan.findUnique.mockResolvedValue(activeManualLoan());

      await expect(
        service.getSuggestedSplit('loan-1', 14_000_000),
      ).resolves.toEqual(
        expect.objectContaining({
          outstandingPrincipal: 200_000_000,
          interestPaid: 14_000_000,
          principalPaid: 0,
        }),
      );

      await expect(
        service.getSuggestedSplit('loan-1', 214_000_000),
      ).resolves.toEqual(
        expect.objectContaining({
          interestPaid: 14_000_000,
          principalPaid: 200_000_000,
        }),
      );
    });

    it('computes the split when staff omit it', async () => {
      prisma.loan.findUnique.mockResolvedValue(activeManualLoan());
      setupManualCreate();

      await service.createManualRepayment(
        {
          loanId: 'loan-1',
          amountPaid: 14_000_000,
          paymentDate: new Date('2026-06-05T08:00:00.000Z'),
        },
        'user-1',
      );

      expect(prisma.repayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amountPaid: 14_000_000,
            principalPaid: 0,
            interestPaid: 14_000_000,
          }),
        }),
      );
    });

    it('honors a valid staff-provided split', async () => {
      prisma.loan.findUnique.mockResolvedValue(activeManualLoan());
      setupManualCreate();

      await service.createManualRepayment(
        {
          loanId: 'loan-1',
          amountPaid: 214_000_000,
          principalPaid: 200_000_000,
          interestPaid: 14_000_000,
          paymentDate: new Date('2026-08-05T08:00:00.000Z'),
        },
        'user-1',
      );

      expect(prisma.repayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            principalPaid: 200_000_000,
            interestPaid: 14_000_000,
          }),
        }),
      );
    });

    it('rejects a split that does not sum to amountPaid', async () => {
      prisma.loan.findUnique.mockResolvedValue(activeManualLoan());

      await expect(
        service.createManualRepayment(
          {
            loanId: 'loan-1',
            amountPaid: 14_000_000,
            principalPaid: 5_000_000,
            interestPaid: 5_000_000,
            paymentDate: new Date('2026-06-05T08:00:00.000Z'),
          },
          'user-1',
        ),
      ).rejects.toThrow('must sum to amountPaid');

      expect(prisma.repayment.create).not.toHaveBeenCalled();
    });

    it('rejects principal exceeding the outstanding balance', async () => {
      prisma.loan.findUnique.mockResolvedValue(
        activeManualLoan({ outstandingBalance: 100_000 }),
      );

      await expect(
        service.createManualRepayment(
          {
            loanId: 'loan-1',
            amountPaid: 200_000,
            principalPaid: 200_000,
            interestPaid: 0,
            paymentDate: new Date('2026-06-05T08:00:00.000Z'),
          },
          'user-1',
        ),
      ).rejects.toThrow('cannot exceed the outstanding principal balance');
    });

    it('decrements outstanding balance by principal only on approval', async () => {
      const tx = {
        repayment: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'rep-1',
            loanId: 'loan-1',
            amountPaid: 14_000_000,
            principalPaid: 0,
            interestPaid: 14_000_000,
            status: RepaymentStatus.PENDING,
            notes: null,
          }),
          update: jest.fn().mockResolvedValue({}),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'rep-1',
            loanId: 'loan-1',
            amountPaid: 14_000_000,
            loan: {
              id: 'loan-1',
              user: null,
              client: {
                individual: { fullName: 'Client One' },
                business: null,
              },
            },
          }),
        },
        loan: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn(tx),
      );
      documentsService.attachDocuments.mockImplementation(
        (_: unknown, r: unknown) => Promise.resolve(r),
      );

      await service.approveRepayment('rep-1', {});

      expect(tx.loan.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            outstandingBalance: { gte: 0 },
          }),
          data: expect.objectContaining({
            outstandingBalance: { decrement: 0 },
            totalRepaidAmount: { increment: 14_000_000 },
            totalInterestReceived: { increment: 14_000_000 },
            totalPrincipalRecovered: { increment: 0 },
          }),
        }),
      );
    });

    it('falls back to full amount when a repayment has no split (online)', async () => {
      const tx = {
        repayment: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'rep-2',
            loanId: 'loan-1',
            amountPaid: 25_000,
            principalPaid: null,
            interestPaid: null,
            status: RepaymentStatus.PENDING,
            notes: null,
          }),
          update: jest.fn().mockResolvedValue({}),
          findUniqueOrThrow: jest.fn().mockResolvedValue({
            id: 'rep-2',
            loanId: 'loan-1',
            amountPaid: 25_000,
            loan: {
              id: 'loan-1',
              user: null,
              client: {
                individual: { fullName: 'Client One' },
                business: null,
              },
            },
          }),
        },
        loan: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      };
      prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
        fn(tx),
      );
      documentsService.attachDocuments.mockImplementation(
        (_: unknown, r: unknown) => Promise.resolve(r),
      );

      await service.approveRepayment('rep-2', {});

      expect(tx.loan.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            outstandingBalance: { gte: 25_000 },
          }),
          data: expect.objectContaining({
            outstandingBalance: { decrement: 25_000 },
          }),
        }),
      );
    });
  });

  it('filters repayment listing by status and source', async () => {
    const createdAt = new Date('2026-05-14T08:00:00.000Z');
    const repayment = {
      id: 'repayment-1',
      loanId: 'loan-1',
      amountPaid: 50000,
      paymentDate: createdAt,
      notes: null,
      source: RepaymentSource.CLIENT_ONLINE,
      paymentProvider: 'MOBILE_MONEY',
      paymentReference: 'PAY-123',
      paymentPhoneNumber: '0788123456',
      status: RepaymentStatus.PENDING,
      approvedAt: null,
      createdAt,
      loan: {
        id: 'loan-1',
        createdAt,
        amount: 100000,
        outstandingBalance: 100000,
        totalRepaidAmount: 0,
        purpose: 'Quick loan application',
        status: 'ACTIVE',
        client: {
          individual: null,
          business: null,
        },
      },
    };

    prisma.repayment.findMany.mockResolvedValue([repayment]);
    prisma.repayment.count.mockResolvedValue(1);
    documentsService.attachDocuments.mockImplementation((_, repayments) =>
      Promise.resolve(repayments),
    );

    await expect(
      service.findAll(
        2,
        5,
        RepaymentStatus.PENDING,
        RepaymentSource.CLIENT_ONLINE,
      ),
    ).resolves.toEqual({
      data: [
        {
          ...repayment,
          loan: {
            amount: 100000,
            outstandingBalance: 100000,
            totalRepaidAmount: 0,
            purpose: 'Quick loan application',
            status: 'ACTIVE',
            client: {
              individual: null,
              business: null,
            },
            id: 'loan-1',
            loanNumber: 'LN-2026-LOAN1',
          },
        },
      ],
      meta: {
        page: 2,
        limit: 5,
        total: 1,
        totalPages: 1,
      },
    });

    expect(prisma.repayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: RepaymentStatus.PENDING,
          source: RepaymentSource.CLIENT_ONLINE,
        },
        skip: 5,
        take: 5,
      }),
    );
    expect(prisma.repayment.count).toHaveBeenCalledWith({
      where: {
        status: RepaymentStatus.PENDING,
        source: RepaymentSource.CLIENT_ONLINE,
      },
    });
    expect(documentsService.attachDocuments).toHaveBeenCalledWith(
      DocumentOwnerType.REPAYMENT,
      expect.arrayContaining([
        expect.objectContaining({
          id: 'repayment-1',
          source: RepaymentSource.CLIENT_ONLINE,
          loan: expect.objectContaining({
            loanNumber: 'LN-2026-LOAN1',
          }),
        }),
      ]),
    );
  });

  it('records an online repayment as pending and initiates the MoMo charge', async () => {
    const now = new Date('2026-05-14T08:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);

    prisma.user.findUnique.mockResolvedValue({
      roles: [UserRole.CLIENT],
      clientOnboardingStatus: ClientOnboardingStatus.ACTIVE,
    });
    prisma.client.findUnique.mockResolvedValue({
      id: 'client-1',
      phoneNumber: '0788123456',
    });
    prisma.loan.findUnique.mockResolvedValue({
      id: 'loan-1',
      clientId: 'client-1',
      status: LoanStatus.ACTIVE,
      currency: 'RWF',
      outstandingBalance: 100000,
      user: null,
      client: {
        individual: { fullName: 'Client One' },
        business: null,
      },
    });
    prisma.repayment.aggregate.mockResolvedValue({
      _sum: { amountPaid: 0 },
    });
    prisma.repayment.findUnique.mockResolvedValue(null);

    // The repayment is persisted as PENDING before MoMo is called; it only
    // becomes APPROVED once the provider callback confirms the charge.
    prisma.repayment.create.mockImplementation(({ data }) =>
      Promise.resolve({
        ...data,
        createdAt: now,
        loan: {
          id: 'loan-1',
          createdAt: now,
          amount: 100000,
          outstandingBalance: 100000,
          totalRepaidAmount: 0,
          purpose: 'Quick loan application',
          status: LoanStatus.ACTIVE,
          user: null,
          client: {
            individual: { fullName: 'Client One' },
            business: null,
          },
        },
      }),
    );
    momoCollections.requestToPay.mockResolvedValue({ referenceId: 'momo-ref' });
    documentsService.attachDocuments.mockImplementation((_, repayments) =>
      Promise.resolve(repayments),
    );

    await expect(
      service.createOnlineRepayment(
        'loan-1',
        {
          amountPaid: 25000,
          paymentProvider: OnlinePaymentProvider.MOBILE_MONEY,
          paymentReference: 'MOMO-123',
        },
        'user-1',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        loanId: 'loan-1',
        amountPaid: 25000,
        source: RepaymentSource.CLIENT_ONLINE,
        paymentProvider: OnlinePaymentProvider.MOBILE_MONEY,
        status: RepaymentStatus.PENDING,
        loan: expect.objectContaining({
          id: 'loan-1',
          loanNumber: 'LN-2026-LOAN1',
        }),
      }),
    );

    // The repayment record is created before the MoMo charge so a fast callback
    // can always find it.
    expect(prisma.repayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          loanId: 'loan-1',
          amountPaid: 25000,
          status: RepaymentStatus.PENDING,
          source: RepaymentSource.CLIENT_ONLINE,
        }),
      }),
    );
    expect(momoCollections.requestToPay).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 25000,
        phoneNumber: '0788123456',
      }),
    );
    expect(
      notificationsService.notifyGeneralManagersRepaymentPendingApproval,
    ).not.toHaveBeenCalled();
  });
});
