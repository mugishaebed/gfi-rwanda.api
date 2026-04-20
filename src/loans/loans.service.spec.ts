jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../notifications/notifications.service', () => ({
  NotificationsService: class NotificationsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { LoansService } from './loans.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';

describe('LoansService', () => {
  let service: LoansService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LoansService,
        {
          provide: PrismaService,
          useValue: {
            loan: {},
            client: {},
            loanStatusLog: {},
            $transaction: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: {
            notifyGeneralManagersLoanPendingApproval: jest.fn(),
            notifyLoanOfficerLoanApproved: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LoansService>(LoansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
