import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from './generated/prisma/client';

const PRISMA_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 15_000,
} as const;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DIRECT_URL or DATABASE_URL must be set');
    }

    const pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 60_000,
      connectionTimeoutMillis: 30_000,
      keepAlive: true, // send TCP keep-alive packets
      keepAliveInitialDelayMillis: 10_000, // start sending keep-alive packets after 10 seconds of inactivity
    });

    const adapter = new PrismaPg(pool);
    super({
      adapter,
      transactionOptions: PRISMA_TRANSACTION_OPTIONS,
    });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
