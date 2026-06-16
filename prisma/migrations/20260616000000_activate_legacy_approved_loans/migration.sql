-- Backfill for legacy loans created under the old status model.
--
-- Under the old model, a loan reaching APPROVED was immediately activated
-- (activatedAt was set on approval) and treated as live/in-repayment. The
-- lifecycle migration (20260610090000) only promoted APPROVED -> ACTIVE when a
-- MoMo `disbursementReference` was present, so pre-MoMo and manual loans — which
-- never carry a reference — were left stranded at APPROVED. In the new model
-- APPROVED means "authorized, not yet disbursed", which blocks repayments and
-- reads as "pending" to clients.
--
-- Promote those genuinely-active loans (status APPROVED with activatedAt set) to
-- ACTIVE, recording the change in the audit log and backfilling the disbursement
-- fields the new model expects.

INSERT INTO "LoanStatusLog" ("id", "loanId", "fromStatus", "toStatus", "changedBy", "note", "createdAt")
SELECT
  gen_random_uuid(),
  "id",
  'APPROVED'::"LoanStatus",
  'ACTIVE'::"LoanStatus",
  'system:migration',
  'Backfill: legacy approved loan promoted to ACTIVE (lifecycle states migration)',
  now()
FROM "Loan"
WHERE "status" = 'APPROVED' AND "activatedAt" IS NOT NULL;

UPDATE "Loan"
SET
  "status" = 'ACTIVE'::"LoanStatus",
  "disbursedAt" = COALESCE("disbursedAt", "activatedAt"),
  "disbursedAmount" = COALESCE("disbursedAmount", "amount")
WHERE "status" = 'APPROVED' AND "activatedAt" IS NOT NULL;
