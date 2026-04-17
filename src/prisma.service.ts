import { Injectable } from '@nestjs/common';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient {
  constructor() {
    const connectionString = process.env.DIRECT_URL;
    if (!connectionString) {
      throw new Error('DIRECT_URL is not set');
    }

    const adapter = new PrismaPg(connectionString);
    super({ adapter });
  }
}
