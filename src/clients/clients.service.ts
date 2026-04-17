import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientType } from 'src/generated/prisma/enums';
import { PrismaService } from 'src/prisma.service';
import {
  CreateBusinessClientDto,
  CreateIndividualClientDto,
} from './dto/create.dto';
import {
  UpdateBusinessClientDto,
  UpdateIndividualClientDto,
} from './dto/update.dto';

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async getClients(page = 1, limit = 10) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const skip = (safePage - 1) * safeLimit;

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
      data: clients,
      meta: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async createIndividualClient(data: CreateIndividualClientDto) {
    if (data.type !== ClientType.INDIVIDUAL) {
      throw new BadRequestException('Invalid client type');
    }

    try {
      return this.prisma.client.create({
        data: {
          type: data.type,
          email: data.email,
          phoneNumber: data.phone,
          address: data.address,
          accountNumber: data.accountNumber,
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
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to create client';
      throw new BadRequestException(message);
    }
  }

  async createBusinessClient(data: CreateBusinessClientDto) {
    if (data.type !== ClientType.BUSINESS) {
      throw new BadRequestException('Invalid client type');
    }

    try {
      return this.prisma.client.create({
        data: {
          type: data.type,
          email: data.email,
          phoneNumber: data.phone,
          address: data.address,
          accountNumber: data.accountNumber,
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
    } catch (error: unknown) {
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
            accountNumber: data.accountNumber,
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

      return this.prisma.client.findUnique({
        where: { id },
        include: { individual: true },
      });
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
            accountNumber: data.accountNumber,
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

      return this.prisma.client.findUnique({
        where: { id },
        include: { business: true },
      });
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
      await this.prisma.client.delete({
        where: { id },
      });

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
      await this.prisma.client.delete({
        where: { id },
      });

      return {
        message: 'Business client deleted successfully',
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to delete client';
      throw new BadRequestException(message);
    }
  }
}
