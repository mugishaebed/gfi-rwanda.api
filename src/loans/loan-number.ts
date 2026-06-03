export type LoanNumberSource = {
  id: string;
  createdAt?: Date | string | null;
};

export function formatLoanNumber(loan: LoanNumberSource) {
  const year = getLoanYear(loan.createdAt);
  const suffix =
    loan.id
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 8)
      .toUpperCase() || loan.id.toUpperCase();

  return year ? `LN-${year}-${suffix}` : `LN-${suffix}`;
}

export function withLoanNumber<T extends LoanNumberSource>(
  loan: T,
): T & { loanNumber: string } {
  return {
    ...loan,
    loanNumber: formatLoanNumber(loan),
  };
}

function getLoanYear(createdAt?: Date | string | null) {
  if (!createdAt) {
    return null;
  }

  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const year = date.getUTCFullYear();

  return Number.isFinite(year) ? year : null;
}
