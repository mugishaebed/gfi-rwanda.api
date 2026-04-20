jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from '../notifications/notifications.service';
import { RepaymentsService } from './repayments.service';
import { PrismaService } from '../prisma.service';

describe('RepaymentsService', () => {
  let service: RepaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RepaymentsService,
        {
          provide: PrismaService,
          useValue: {
            repayment: {},
            loan: {},
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyGeneralManagersRepaymentPendingApproval: jest.fn(),
            notifyLoanOfficerRepaymentApproved: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RepaymentsService>(RepaymentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
