jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

describe('ClientsController', () => {
  let controller: ClientsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientsController],
      providers: [
        {
          provide: ClientsService,
          useValue: {
            getClients: jest.fn(),
            getClientById: jest.fn(),
            getMyProfile: jest.fn(),
            getPendingApprovalClients: jest.fn(),
            createIndividualClient: jest.fn(),
            createBusinessClient: jest.fn(),
            updateIndividualClient: jest.fn(),
            updateBusinessClient: jest.fn(),
            deleteIndividualClient: jest.fn(),
            deleteBusinessClient: jest.fn(),
            approveClientProfile: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ClientsController>(ClientsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
