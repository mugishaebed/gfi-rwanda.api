jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { RepaymentsController } from './repayments.controller';
import { RepaymentsService } from './repayments.service';

describe('RepaymentsController', () => {
  let controller: RepaymentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RepaymentsController],
      providers: [
        {
          provide: RepaymentsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            createManualRepayment: jest.fn(),
            approveRepayment: jest.fn(),
            rejectRepayment: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<RepaymentsController>(RepaymentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
