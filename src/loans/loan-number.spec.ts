import { formatLoanNumber, withLoanNumber } from './loan-number';

describe('loan number formatting', () => {
  it('formats a stable loan number from the creation year and id prefix', () => {
    expect(
      formatLoanNumber({
        id: '123e4567-e89b-12d3-a456-426614174000',
        createdAt: new Date('2026-05-13T10:30:00.000Z'),
      }),
    ).toBe('LN-2026-123E4567');
  });

  it('adds loanNumber while preserving the original loan fields', () => {
    expect(
      withLoanNumber({
        id: 'abcdef12-3456-7890-abcd-ef1234567890',
        createdAt: '2026-05-13T10:30:00.000Z',
        amount: 150000,
      }),
    ).toEqual({
      id: 'abcdef12-3456-7890-abcd-ef1234567890',
      createdAt: '2026-05-13T10:30:00.000Z',
      amount: 150000,
      loanNumber: 'LN-2026-ABCDEF12',
    });
  });
});
