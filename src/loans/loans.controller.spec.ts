jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { LoansController } from './loans.controller';
import { LoansService } from './loans.service';

describe('LoansController', () => {
  let controller: LoansController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LoansController],
      providers: [
        {
          provide: LoansService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
            createLoan: jest.fn(),
            approveLoan: jest.fn(),
            rejectLoan: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<LoansController>(LoansController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
