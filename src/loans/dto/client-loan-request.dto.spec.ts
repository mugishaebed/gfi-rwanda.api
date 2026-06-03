import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DisbursementMethod } from '../../generated/prisma/enums';
import { ClientLoanRequestDto } from './client-loan-request.dto';

async function validatePayload(payload: Record<string, unknown>) {
  const dto = plainToInstance(ClientLoanRequestDto, payload);
  return validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('ClientLoanRequestDto', () => {
  it('accepts the dashboard loan request payload', async () => {
    await expect(
      validatePayload({
        amount: 150000,
        currency: 'RWF',
        termInMonths: 1,
        termsAccepted: true,
        termsVersion: 'loan-request-v1',
        disbursementMethod: DisbursementMethod.MOBILE_MONEY,
      }),
    ).resolves.toHaveLength(0);
  });

  it('rejects untrusted calculated fields from the request body', async () => {
    const errors = await validatePayload({
      amount: 150000,
      currency: 'RWF',
      termInMonths: 1,
      termsAccepted: true,
      termsVersion: 'loan-request-v1',
      disbursementMethod: DisbursementMethod.MOBILE_MONEY,
      totalRepayment: 1,
      interestAmount: 1,
      dueDate: '2026-06-12',
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['totalRepayment', 'interestAmount', 'dueDate']),
    );
  });

  it('enforces amount, one-month term, and accepted terms', async () => {
    const errors = await validatePayload({
      amount: 99,
      currency: 'RWF',
      termInMonths: 2,
      termsAccepted: false,
      termsVersion: 'loan-request-v1',
      disbursementMethod: DisbursementMethod.MOBILE_MONEY,
    });

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['amount', 'termInMonths', 'termsAccepted']),
    );
  });
});
