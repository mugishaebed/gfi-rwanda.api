jest.mock('../prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

jest.mock('../documents/documents.service', () => ({
  DocumentsService: class DocumentsService {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClientOnboardingStatus } from '../generated/prisma/enums';
import { ClientSourceFilter, ClientsService } from './clients.service';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma.service';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: {
    $queryRaw: jest.Mock;
    client: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
  };
  let documentsService: {
    attachDocuments: jest.Mock;
    prepareDocuments: jest.Mock;
    createMany: jest.Mock;
    cleanupPreparedDocuments: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      $queryRaw: jest.fn(),
      client: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
    };
    documentsService = {
      attachDocuments: jest.fn(),
      prepareDocuments: jest.fn(),
      createMany: jest.fn(),
      cleanupPreparedDocuments: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientsService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: DocumentsService,
          useValue: documentsService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ClientsService>(ClientsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns clients with manual or online source metadata', async () => {
    const manualClient = {
      id: 'client-1',
      type: 'INDIVIDUAL',
      email: 'manual@example.com',
      userId: null,
      individual: { fullName: 'Manual Client' },
      business: null,
    };
    const onlineUser = {
      id: 'user-1',
      name: 'Online Client',
      email: 'online@example.com',
      roles: ['CLIENT'],
      clientOnboardingStatus: ClientOnboardingStatus.PENDING_APPROVAL,
      clientApprovedAt: null,
      createdAt: new Date('2026-05-09T10:00:00.000Z'),
      updatedAt: new Date('2026-05-10T10:00:00.000Z'),
    };
    const onlineClient = {
      id: 'client-2',
      type: 'INDIVIDUAL',
      email: onlineUser.email,
      userId: onlineUser.id,
      individual: { fullName: 'Online Client' },
      business: null,
    };

    prisma.client.findMany.mockResolvedValue([manualClient, onlineClient]);
    prisma.client.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([onlineUser]);
    documentsService.attachDocuments.mockResolvedValue([
      { ...manualClient, documents: [] },
      { ...onlineClient, documents: [] },
    ]);

    await expect(
      service.getClients(1, 10, ClientSourceFilter.ALL),
    ).resolves.toEqual({
      data: [
        {
          ...manualClient,
          documents: [],
          source: ClientSourceFilter.MANUAL,
          user: null,
        },
        {
          ...onlineClient,
          documents: [],
          source: ClientSourceFilter.ONLINE,
          user: onlineUser,
        },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      },
    });
  });

  it('returns one client profile with documents and linked user metadata', async () => {
    const client = {
      id: 'client-1',
      type: 'INDIVIDUAL',
      email: 'client@example.com',
      userId: 'user-1',
      individual: { fullName: 'Client One' },
      business: null,
    };
    const user = {
      id: 'user-1',
      name: 'Client One',
      email: client.email,
      roles: ['CLIENT'],
      clientOnboardingStatus: ClientOnboardingStatus.ACTIVE,
      clientApprovedAt: new Date('2026-05-10T10:00:00.000Z'),
      createdAt: new Date('2026-05-09T10:00:00.000Z'),
      updatedAt: new Date('2026-05-10T10:00:00.000Z'),
    };

    prisma.client.findUnique.mockResolvedValue(client);
    prisma.user.findUnique.mockResolvedValue(user);
    documentsService.attachDocuments.mockResolvedValue([
      { ...client, documents: [] },
    ]);

    await expect(service.getClientById(client.id)).resolves.toEqual({
      ...client,
      documents: [],
      user,
    });
    expect(prisma.client.findUnique).toHaveBeenCalledWith({
      where: { id: client.id },
      include: {
        individual: true,
        business: true,
      },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: client.userId },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        clientOnboardingStatus: true,
        clientApprovedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('throws when one client profile is not found', async () => {
    prisma.client.findUnique.mockResolvedValue(null);

    await expect(service.getClientById('missing-client')).rejects.toThrow(
      'Client not found',
    );
  });

  it('returns current client user fields with no client profile before completion', async () => {
    const user = {
      id: 'user-1',
      name: 'New Client',
      email: 'new-client@example.com',
      roles: ['CLIENT'],
      clientOnboardingStatus: ClientOnboardingStatus.PENDING_PROFILE,
      clientApprovedAt: null,
      createdAt: new Date('2026-05-09T10:00:00.000Z'),
      updatedAt: new Date('2026-05-09T10:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue(user);
    prisma.client.findUnique.mockResolvedValue(null);

    await expect(service.getMyProfile(user.id)).resolves.toEqual({
      user,
      client: null,
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        roles: true,
        clientOnboardingStatus: true,
        clientApprovedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    expect(prisma.client.findUnique).toHaveBeenCalledWith({
      where: { userId: user.id },
      include: {
        individual: true,
        business: true,
      },
    });
  });

  it('returns current client user fields with completed client profile and documents', async () => {
    const user = {
      id: 'user-1',
      name: 'Client One',
      email: 'client@example.com',
      roles: ['CLIENT'],
      clientOnboardingStatus: ClientOnboardingStatus.PENDING_APPROVAL,
      clientApprovedAt: null,
      createdAt: new Date('2026-05-09T10:00:00.000Z'),
      updatedAt: new Date('2026-05-10T10:00:00.000Z'),
    };
    const client = {
      id: 'client-1',
      type: 'INDIVIDUAL',
      email: user.email,
      userId: user.id,
      individual: { fullName: 'Client One' },
      business: null,
    };

    prisma.user.findUnique.mockResolvedValue(user);
    prisma.client.findUnique.mockResolvedValue(client);
    documentsService.attachDocuments.mockResolvedValue([
      { ...client, documents: [] },
    ]);

    await expect(service.getMyProfile(user.id)).resolves.toEqual({
      user,
      client: {
        ...client,
        documents: [],
      },
    });
  });

  it('throws when current client user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.getMyProfile('missing-user')).rejects.toThrow(
      'User not found',
    );
  });

  it('returns client profiles pending approval with linked user metadata', async () => {
    const userCreatedAt = new Date('2026-05-09T10:00:00.000Z');
    const userUpdatedAt = new Date('2026-05-10T10:00:00.000Z');
    const client = {
      id: 'client-1',
      type: 'INDIVIDUAL',
      email: 'client@example.com',
      userId: 'user-1',
      individual: { fullName: 'Pending Client' },
      business: null,
    };

    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          clientId: client.id,
          userId: 'user-1',
          name: 'Pending Client',
          email: client.email,
          clientOnboardingStatus: ClientOnboardingStatus.PENDING_APPROVAL,
          clientApprovedAt: null,
          userCreatedAt,
          userUpdatedAt,
        },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    prisma.client.findMany.mockResolvedValue([client]);
    documentsService.attachDocuments.mockResolvedValue([
      { ...client, documents: [] },
    ]);

    await expect(service.getPendingApprovalClients(1, 10)).resolves.toEqual({
      data: [
        {
          ...client,
          documents: [],
          user: {
            id: 'user-1',
            name: 'Pending Client',
            email: client.email,
            clientOnboardingStatus: ClientOnboardingStatus.PENDING_APPROVAL,
            clientApprovedAt: null,
            createdAt: userCreatedAt,
            updatedAt: userUpdatedAt,
          },
        },
      ],
      meta: {
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      },
    });
    expect(prisma.client.findMany).toHaveBeenCalledWith({
      where: {
        id: {
          in: [client.id],
        },
      },
      include: {
        individual: true,
        business: true,
      },
    });
  });
});
