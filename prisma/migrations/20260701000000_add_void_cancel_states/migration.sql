-- Adds correction states used by GM-only edit/soft-delete:
--   RepaymentStatus.VOIDED  — an approved repayment whose financial effect on the
--                             loan has been reversed (soft delete, keeps history).
--   LoanStatus.CANCELLED    — a loan removed from the active book (soft delete);
--                             drops out of the ACTIVE-only ledger and dashboards.
-- Enum value additions are additive and non-destructive; each runs on its own
-- statement (Postgres forbids ALTER TYPE ... ADD VALUE inside a transaction).

ALTER TYPE "RepaymentStatus" ADD VALUE 'VOIDED';

ALTER TYPE "LoanStatus" ADD VALUE 'CANCELLED';
