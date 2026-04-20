jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ClientsService } from './clients.service';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma.service';

describe('ClientsService', () => {
  let service: ClientsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: PrismaService,
          useValue: {
            client: {},
          },
        },
        {
          provide: DocumentsService,
          useValue: {
            attachDocuments: jest.fn(),
            prepareDocuments: jest.fn(),
            createMany: jest.fn(),
            cleanupPreparedDocuments: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
