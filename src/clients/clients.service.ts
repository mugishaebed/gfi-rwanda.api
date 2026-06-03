import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  ClientOnboardingStatus,
  ClientType,
  DocumentOwnerType,
  UserRole,
} from '../generated/prisma/enums';
import { DocumentsService } from '../documents/documents.service';
import { PrismaService } from '../prisma.service';
import {
  CreateBusinessClientDto,
  CreateIndividualClientDto,
} from './dto/create.dto';
import {
  UpdateBusinessClientDto,
  UpdateIndividualClientDto,
} from './dto/update.dto';

type PendingApprovalClientRow = {
  clientId: string;
  userId: string;
  name: string;
  email: string;
  clientOnboardingStatus: ClientOnboardingStatus;
  clientApprovedAt: Date | null;
  userCreatedAt: Date;
  userUpdatedAt: Date;
};

type ClientIdRow = {
  clientId: string;
};

const clientProfileUserSelect = {
  id: true,
  name: true,
  email: true,
  roles: true,
  clientOnboardingStatus: true,
  clientApprovedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export enum ClientSourceFilter {
  ALL = 'ALL',
  MANUAL = 'MANUAL',
  ONLINE = 'ONLINE',
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documentsService: DocumentsService,
    private readonly configService: ConfigService,
  ) {}

  private getPagination(page = 1, limit = 10) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    return { safePage, safeLimit, skip };
  }

  async getClients(
    page = 1,
    limit = 10,
    source: ClientSourceFilter = ClientSourceFilter.ALL,
  ) {
    const { safePage, safeLimit, skip } = this.getPagination(page, limit);

    if (source !== ClientSourceFilter.ALL) {
      return this.getClientsBySource(source, safePage, safeLimit, skip);
    }

    const [clients, total] = await Promise.all([
      this.prisma.client.findMany({
        skip,
        take: safeLimit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          individual: true,
          business: true,
        },
      }),
      this.prisma.client.count(),
    ]);

    return {
      data: await this.attachClientSources(
        await this.documentsService.attachDocuments(
          DocumentOwnerType.CLIENT,
          clients,
        ),
      ),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  private async getClientsBySource(
    source: ClientSourceFilter.MANUAL | ClientSourceFilter.ONLINE,
    safePage: number,
    safeLimit: number,
    skip: number,
  ) {
    const [rows, countRows] =
      source === ClientSourceFilter.ONLINE
        ? await Promise.all([
            this.prisma.$queryRaw<ClientIdRow[]>`
              SELECT c.id AS "clientId"
              FROM "Client" c
              INNER JOIN "User" u ON u.id = c."userId"
              WHERE ${UserRole.CLIENT}::"UserRole" = ANY(u.roles)
              ORDER BY c."createdAt" DESC
              LIMIT ${safeLimit}
              OFFSET ${skip}
            `,
            this.prisma.$queryRaw<Array<{ total: number | bigint }>>`
              SELECT COUNT(*)::integer AS total
              FROM "Client" c
              INNER JOIN "User" u ON u.id = c."userId"
              WHERE ${UserRole.CLIENT}::"UserRole" = ANY(u.roles)
            `,
          ])
        : await Promise.all([
            this.prisma.$queryRaw<ClientIdRow[]>`
              SELECT c.id AS "clientId"
              FROM "Client" c
              LEFT JOIN "User" u
                ON u.id = c."userId"
                AND ${UserRole.CLIENT}::"UserRole" = ANY(u.roles)
              WHERE u.id IS NULL
              ORDER BY c."createdAt" DESC
              LIMIT ${safeLimit}
              OFFSET ${skip}
            `,
            this.prisma.$queryRaw<Array<{ total: number | bigint }>>`
              SELECT COUNT(*)::integer AS total
              FROM "Client" c
              LEFT JOIN "User" u
                ON u.id = c."userId"
                AND ${UserRole.CLIENT}::"UserRole" = ANY(u.roles)
              WHERE u.id IS NULL
            `,
          ]);
    const total = Number(countRows[0]?.total ?? 0);

    if (rows.length === 0) {
      return {
        data: [],
        meta: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      };
    }

    const clients = await this.prisma.client.findMany({
      where: {
        id: {
          in: rows.map((row) => row.clientId),
        },
      },
      include: {
        individual: true,
        business: true,
      },
    });
    const clientsById = new Map(clients.map((client) => [client.id, client]));
    const orderedClients = rows
      .map((row) => clientsById.get(row.clientId))
      .filter((client) => client !== undefined);

    return {
      data: await this.attachClientSources(
        await this.documentsService.attachDocuments(
          DocumentOwnerType.CLIENT,
          orderedClients,
        ),
      ),
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  private async attachClientSources<T extends { userId?: string | null }>(
    clients: T[],
  ) {
    if (clients.length === 0) {
      return [];
    }

    const userIds = clients
      .map((client) => client.userId)
      .filter((userId): userId is string => Boolean(userId));

    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: userIds,
        },
        roles: {
          has: UserRole.CLIENT,
        },
      },
      select: clientProfileUserSelect,
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    return clients.map((client) => {
      const user = client.userId ? (usersById.get(client.userId) ?? null) : null;

      return {
        ...client,
        source: user ? ClientSourceFilter.ONLINE : ClientSourceFilter.MANUAL,
        user,
      };
    });
  }

  async getClientById(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        individual: true,
        business: true,
      },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    const [clientWithDocuments] = await this.documentsService.attachDocuments(
      DocumentOwnerType.CLIENT,
      [client],
    );

    const user = client.userId
      ? await this.prisma.user.findUnique({
          where: { id: client.userId },
          select: clientProfileUserSelect,
        })
      : null;

    return {
      ...clientWithDocuments,
      user,
    };
  }

  async getMyProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: clientProfileUserSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const client = await this.prisma.client.findUnique({
      where: { userId },
      include: {
        individual: true,
        business: true,
      },
    });

    if (!client) {
      return {
        user,
        client: null,
      };
    }

    const [clientWithDocuments] = await this.documentsService.attachDocuments(
      DocumentOwnerType.CLIENT,
      [client],
    );

    return {
      user,
      client: clientWithDocuments,
    };
  }

  async getPendingApprovalClients(page = 1, limit = 10) {
    const { safePage, safeLimit, skip } = this.getPagination(page, limit);

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<PendingApprovalClientRow[]>`
        SELECT
          c.id AS "clientId",
          u.id AS "userId",
          u.name,
          u.email,
          u."clientOnboardingStatus"::text AS "clientOnboardingStatus",
          u."clientApprovedAt",
          u."createdAt" AS "userCreatedAt",
          u."updatedAt" AS "userUpdatedAt"
        FROM "Client" c
        INNER JOIN "User" u ON u.id = c."userId"
        WHERE u."clientOnboardingStatus" = ${ClientOnboardingStatus.PENDING_APPROVAL}::"ClientOnboardingStatus"
          AND ${UserRole.CLIENT}::"UserRole" = ANY(u.roles)
        ORDER BY u."updatedAt" DESC, c."createdAt" DESC
        LIMIT ${safeLimit}
        OFFSET ${skip}
      `,
      this.prisma.$queryRaw<Array<{ total: number | bigint }>>`
        SELECT COUNT(*)::integer AS total
        FROM "Client" c
        INNER JOIN "User" u ON u.id = c."userId"
        WHERE u."clientOnboardingStatus" = ${ClientOnboardingStatus.PENDING_APPROVAL}::"ClientOnboardingStatus"
          AND ${UserRole.CLIENT}::"UserRole" = ANY(u.roles)
      `,
    ]);

    const total = Number(countRows[0]?.total ?? 0);

    if (rows.length === 0) {
      return {
        data: [],
        meta: {
          page: safePage,
          limit: safeLimit,
          total,
          totalPages: Math.ceil(total / safeLimit),
        },
      };
    }

    const clients = await this.prisma.client.findMany({
      where: {
        id: {
          in: rows.map((row) => row.clientId),
        },
      },
      include: {
        individual: true,
        business: true,
      },
    });

    const clientsWithDocuments = await this.documentsService.attachDocuments(
      DocumentOwnerType.CLIENT,
      clients,
    );
    const clientsById = new Map(
      clientsWithDocuments.map((client) => [client.id, client]),
    );

    const data = rows
      .map((row) => {
        const client = clientsById.get(row.clientId);

        if (!client) {
          return null;
        }

        return {
          ...client,
          user: {
            id: row.userId,
            name: row.name,
            email: row.email,
            clientOnboardingStatus: row.clientOnboardingStatus,
            clientApprovedAt: row.clientApprovedAt,
            createdAt: row.userCreatedAt,
            updatedAt: row.userUpdatedAt,
          },
        };
      })
      .filter((client) => client !== null);

    return {
      data,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  private async generateAccountNumber(): Promise<string> {
    const prefix = this.configService.get<string>(
      'ACCOUNT_NUMBER_PREFIX',
      'GFI',
    );
    for (let attempt = 0; attempt < 10; attempt++) {
      const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
      const accountNumber = `${prefix}-${suffix}`;
      const existing = await this.prisma.client.findUnique({
        where: { accountNumber },
        select: { id: true },
      });
      if (!existing) return accountNumber;
    }
    throw new BadRequestException('Failed to generate a unique account number');
  }

  async createIndividualClient(
    data: CreateIndividualClientDto,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
    uploadedByUserId: string,
    linkedUserId?: string,
  ) {
    if (data.type !== ClientType.INDIVIDUAL) {
      throw new BadRequestException('Invalid client type');
    }

    const accountNumber = await this.generateAccountNumber();
    const clientId = randomUUID();
    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.CLIENT,
      ownerId: clientId,
      labels: data.documentLabels,
      files,
      uploadedByUserId,
    });

    try {
      const client = await this.prisma.$transaction(
        async (tx) => {
          const createdClient = await tx.client.create({
            data: {
              id: clientId,
              type: data.type,
              email: data.email,
              phoneNumber: data.phone,
              address: data.address,
              accountNumber,
              userId: linkedUserId,
              individual: {
                create: {
                  fullName: data.fullName,
                  nationalId: data.nationalId,
                  gender: data.gender,
                  dateOfBirth: data.dateOfBirth,
                  nationality: data.nationality,
                  maritalStatus: data.maritalStatus,
                  employerName: data.employerName,
                  occupation: data.occupation,
                  monthlyIncome: data.monthlyIncome,
                  bankName: data.bankName,
                  bankAccountNumber: data.bankAccountNumber,
                  pep: data.pep,
                  referenceName: data.referenceName,
                },
              },
            },
            include: {
              individual: true,
            },
          });

          await this.documentsService.createMany(preparedDocuments, tx);

          return createdClient;
        },
        { timeout: 20000, maxWait: 10000 },
      );

      return (
        await this.documentsService.attachDocuments(DocumentOwnerType.CLIENT, [
          client,
        ])
      )[0];
    } catch (error: unknown) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      const message =
        error instanceof Error ? error.message : 'Failed to create client';
      throw new BadRequestException(message);
    }
  }

  async createBusinessClient(
    data: CreateBusinessClientDto,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
    uploadedByUserId: string,
    linkedUserId?: string,
  ) {
    if (data.type !== ClientType.BUSINESS) {
      throw new BadRequestException('Invalid client type');
    }

    const accountNumber = await this.generateAccountNumber();
    const clientId = randomUUID();
    const preparedDocuments = await this.documentsService.prepareDocuments({
      ownerType: DocumentOwnerType.CLIENT,
      ownerId: clientId,
      labels: data.documentLabels,
      files,
      uploadedByUserId,
    });

    try {
      const client = await this.prisma.$transaction(
        async (tx) => {
          const createdClient = await tx.client.create({
            data: {
              id: clientId,
              type: data.type,
              email: data.email,
              phoneNumber: data.phone,
              address: data.address,
              accountNumber,
              userId: linkedUserId,
              business: {
                create: {
                  businessName: data.businessName,
                  businessWebsite: data.businessWebsite,
                  pep: data.pep,
                  registrationNumber: data.registrationNumber,
                  businessType: data.businessType,
                  incorporationDate: data.incorporationDate,
                  businessShareholders: data.businessShareholders.map(
                    (shareholder) => ({
                      name: shareholder.name,
                      ownershipPercentage: shareholder.ownershipPercentage,
                    }),
                  ),
                  bankName: data.bankName,
                  bankAccountNumber: data.bankAccountNumber,
                  authorizedSignatory: data.authorizedSignatory,
                  authorizedSignatoryDesignation:
                    data.authorizedSignatoryDesignation,
                  annualRevenue: data.annualRevenue,
                },
              },
            },
            include: {
              business: true,
            },
          });

          await this.documentsService.createMany(preparedDocuments, tx);

          return createdClient;
        },
        { timeout: 20000, maxWait: 10000 },
      );

      return (
        await this.documentsService.attachDocuments(DocumentOwnerType.CLIENT, [
          client,
        ])
      )[0];
    } catch (error: unknown) {
      await this.documentsService.cleanupPreparedDocuments(preparedDocuments);
      const message =
        error instanceof Error ? error.message : 'Failed to create client';
      throw new BadRequestException(message);
    }
  }

  async updateIndividualClient(id: string, data: UpdateIndividualClientDto) {
    if (data.type && data.type !== ClientType.INDIVIDUAL) {
      throw new BadRequestException('Invalid client type');
    }

    const existingClient = await this.prisma.client.findUnique({
      where: { id },
      include: { individual: true },
    });

    if (!existingClient || !existingClient.individual) {
      throw new NotFoundException('Individual client not found');
    }

    if (existingClient.type !== ClientType.INDIVIDUAL) {
      throw new BadRequestException('Client is not an individual client');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.client.update({
          where: { id },
          data: {
            type: data.type,
            email: data.email,
            phoneNumber: data.phone,
            address: data.address,
          },
        });

        await tx.individualClient.update({
          where: { clientId: id },
          data: {
            fullName: data.fullName,
            nationalId: data.nationalId,
            gender: data.gender,
            dateOfBirth: data.dateOfBirth,
            nationality: data.nationality,
            maritalStatus: data.maritalStatus,
            employerName: data.employerName,
            occupation: data.occupation,
            monthlyIncome: data.monthlyIncome,
            bankName: data.bankName,
            bankAccountNumber: data.bankAccountNumber,
            pep: data.pep,
            referenceName: data.referenceName,
          },
        });
      });

      const client = await this.prisma.client.findUnique({
        where: { id },
        include: { individual: true },
      });

      if (!client) {
        throw new NotFoundException('Individual client not found');
      }

      return (
        await this.documentsService.attachDocuments(DocumentOwnerType.CLIENT, [
          client,
        ])
      )[0];
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Failed to update client';
      throw new BadRequestException(message);
    }
  }

  async updateBusinessClient(id: string, data: UpdateBusinessClientDto) {
    if (data.type && data.type !== ClientType.BUSINESS) {
      throw new BadRequestException('Invalid client type');
    }

    const existingClient = await this.prisma.client.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!existingClient || !existingClient.business) {
      throw new NotFoundException('Business client not found');
    }

    if (existingClient.type !== ClientType.BUSINESS) {
      throw new BadRequestException('Client is not a business client');
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.client.update({
          where: { id },
          data: {
            type: data.type,
            email: data.email,
            phoneNumber: data.phone,
            address: data.address,
          },
        });

        await tx.businessClient.update({
          where: { clientId: id },
          data: {
            businessName: data.businessName,
            businessWebsite: data.businessWebsite,
            pep: data.pep,
            registrationNumber: data.registrationNumber,
            businessType: data.businessType,
            incorporationDate: data.incorporationDate,
            businessShareholders: data.businessShareholders?.map(
              (shareholder) => ({
                name: shareholder.name,
                ownershipPercentage: shareholder.ownershipPercentage,
              }),
            ),
            bankName: data.bankName,
            bankAccountNumber: data.bankAccountNumber,
            authorizedSignatory: data.authorizedSignatory,
            authorizedSignatoryDesignation: data.authorizedSignatoryDesignation,
            annualRevenue: data.annualRevenue,
          },
        });
      });

      const client = await this.prisma.client.findUnique({
        where: { id },
        include: { business: true },
      });

      if (!client) {
        throw new NotFoundException('Business client not found');
      }

      return (
        await this.documentsService.attachDocuments(DocumentOwnerType.CLIENT, [
          client,
        ])
      )[0];
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException
      ) {
        throw error;
      }

      const message =
        error instanceof Error ? error.message : 'Failed to update client';
      throw new BadRequestException(message);
    }
  }

  async deleteIndividualClient(id: string) {
    const existingClient = await this.prisma.client.findUnique({
      where: { id },
      include: { individual: true },
    });

    if (!existingClient || !existingClient.individual) {
      throw new NotFoundException('Individual client not found');
    }

    if (existingClient.type !== ClientType.INDIVIDUAL) {
      throw new BadRequestException('Client is not an individual client');
    }

    try {
      await this.prisma.$transaction([
        this.prisma.individualClient.delete({
          where: { clientId: id },
        }),
        this.prisma.client.delete({
          where: { id },
        }),
      ]);

      return {
        message: 'Individual client deleted successfully',
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete client';
      throw new BadRequestException(message);
    }
  }

  async deleteBusinessClient(id: string) {
    const existingClient = await this.prisma.client.findUnique({
      where: { id },
      include: { business: true },
    });

    if (!existingClient || !existingClient.business) {
      throw new NotFoundException('Business client not found');
    }

    if (existingClient.type !== ClientType.BUSINESS) {
      throw new BadRequestException('Client is not a business client');
    }

    try {
      await this.prisma.$transaction([
        this.prisma.businessClient.delete({
          where: { clientId: id },
        }),
        this.prisma.client.delete({
          where: { id },
        }),
      ]);

      return {
        message: 'Business client deleted successfully',
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete client';
      throw new BadRequestException(message);
    }
  }

  async completeMyIndividualProfile(
    userId: string,
    userEmail: string,
    data: CreateIndividualClientDto,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, clientOnboardingStatus: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      user.clientOnboardingStatus !== ClientOnboardingStatus.PENDING_PROFILE
    ) {
      throw new BadRequestException('Client profile is already completed');
    }

    const payload: CreateIndividualClientDto = {
      ...data,
      email: userEmail,
      type: ClientType.INDIVIDUAL,
    };

    const client = await this.createIndividualClient(
      payload,
      files,
      userId,
      userId,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        clientOnboardingStatus: ClientOnboardingStatus.PENDING_APPROVAL,
      },
    });

    return client;
  }

  async completeMyBusinessProfile(
    userId: string,
    userEmail: string,
    data: CreateBusinessClientDto,
    files: Array<{
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    }> = [],
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, clientOnboardingStatus: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (
      user.clientOnboardingStatus !== ClientOnboardingStatus.PENDING_PROFILE
    ) {
      throw new BadRequestException('Client profile is already completed');
    }

    const payload: CreateBusinessClientDto = {
      ...data,
      email: userEmail,
      type: ClientType.BUSINESS,
    };

    const client = await this.createBusinessClient(
      payload,
      files,
      userId,
      userId,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        clientOnboardingStatus: ClientOnboardingStatus.PENDING_APPROVAL,
      },
    });

    return client;
  }

  async approveClientProfile(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { userId: true },
    });

    if (!client) {
      throw new NotFoundException('Client not found');
    }

    if (!client.userId) {
      throw new NotFoundException('Client account not found');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: client.userId },
      select: { id: true, roles: true, clientOnboardingStatus: true },
    });

    if (!user) {
      throw new NotFoundException('Client account not found');
    }

    if (!user.roles.includes(UserRole.CLIENT)) {
      throw new BadRequestException('User is not a client account');
    }

    if (
      user.clientOnboardingStatus !== ClientOnboardingStatus.PENDING_APPROVAL
    ) {
      throw new BadRequestException('Client profile is not awaiting approval');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        clientOnboardingStatus: ClientOnboardingStatus.ACTIVE,
        clientApprovedAt: new Date(),
      },
    });

    return { message: 'Client profile approved successfully' };
  }
}
