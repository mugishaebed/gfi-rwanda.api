import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

export type MomoCallbackStatus = 'SUCCESSFUL' | 'FAILED' | 'PENDING';

export interface MomoRequestToPayResult {
  referenceId: string;
}

export interface MomoTransactionStatus {
  status: MomoCallbackStatus;
  financialTransactionId?: string;
  reason?: string;
}

@Injectable()
export class MomoCollectionsService {
  private readonly logger = new Logger(MomoCollectionsService.name);
  private readonly baseUrl: string;
  private readonly subscriptionKey: string;
  private readonly targetEnvironment: string;
  private readonly callbackHost: string;
  private readonly userId: string;
  private readonly apiKey: string;
  private cachedToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'MOMO_BASE_URL',
      'https://sandbox.momodeveloper.mtn.com',
    );
    this.subscriptionKey = this.configService.getOrThrow<string>(
      'MOMO_COLLECTIONS_SUBSCRIPTION_KEY',
    );
    this.targetEnvironment = this.configService.get<string>(
      'MOMO_TARGET_ENVIRONMENT',
      'sandbox',
    );
    this.callbackHost = this.configService.getOrThrow<string>(
      'MOMO_CALLBACK_HOST',
    );
    this.userId = this.configService.getOrThrow<string>(
      'MOMO_COLLECTIONS_USER_ID',
    );
    this.apiKey = this.configService.getOrThrow<string>(
      'MOMO_COLLECTIONS_API_KEY',
    );
  }

  // Sandbox requires EUR; production uses the real local currency (RWF)
  private get currency() {
    return this.configService.get<string>('MOMO_CURRENCY', 'EUR');
  }

  async requestToPay(params: {
    amount: number;
    currency: string;
    phoneNumber: string;
    externalId: string;
    payerMessage: string;
    payeeNote: string;
    referenceId?: string;
  }): Promise<MomoRequestToPayResult> {
    const referenceId = params.referenceId ?? randomUUID();
    this.logger.log(`MoMo requestToPay: amount=${Math.round(params.amount)}, currency=${this.currency}, msisdn=${this.normalizeMsisdn(params.phoneNumber)}`);
    const token = await this.getAccessToken();

    const response = await fetch(
      `${this.baseUrl}/collection/v1_0/requesttopay`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Reference-Id': referenceId,
          'X-Target-Environment': this.targetEnvironment,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
          'X-Callback-Url': `${this.callbackHost}/repayments/momo/callback`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: String(Math.round(params.amount)),
          currency: this.currency,
          externalId: params.externalId,
          payer: {
            partyIdType: 'MSISDN',
            partyId: this.normalizeMsisdn(params.phoneNumber),
          },
          payerMessage: params.payerMessage,
          payeeNote: params.payeeNote,
        }),
      },
    );

    if (response.status !== 202) {
      const body = await response.text();
      this.logger.error(
        `MoMo requesttopay failed [${response.status}]: ${body}`,
      );
      throw new Error(`MoMo requesttopay failed with status ${response.status}`);
    }

    return { referenceId };
  }

  async getTransactionStatus(
    referenceId: string,
  ): Promise<MomoTransactionStatus> {
    const token = await this.getAccessToken();

    const response = await fetch(
      `${this.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.targetEnvironment,
          'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        },
      },
    );

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `MoMo collection status check failed [${response.status}]: ${body}`,
      );
      throw new Error(
        `MoMo collection status check failed with status ${response.status}`,
      );
    }

    const data = (await response.json()) as {
      status: MomoCallbackStatus;
      financialTransactionId?: string;
      reason?: { code?: string; message?: string } | string;
    };

    return {
      status: data.status,
      financialTransactionId: data.financialTransactionId,
      reason:
        typeof data.reason === 'string'
          ? data.reason
          : data.reason?.message ?? data.reason?.code,
    };
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    const credentials = Buffer.from(
      `${this.userId}:${this.apiKey}`,
    ).toString('base64');

    const response = await fetch(`${this.baseUrl}/collection/token/`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.error(
        `MoMo collections token fetch failed [${response.status}]: ${body}`,
      );
      throw new Error('Failed to obtain MoMo collections access token');
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = data.access_token;
    // Refresh 60 seconds before actual expiry to avoid edge cases
    this.tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;

    return this.cachedToken;
  }

  private normalizeMsisdn(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
      return `250${digits.slice(1)}`;
    }
    return digits;
  }
}
