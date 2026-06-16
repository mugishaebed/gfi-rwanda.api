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
