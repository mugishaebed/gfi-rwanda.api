-- Rework the LoanStatus enum to model the full loan lifecycle:
--   * separate officer-review and GM-approval gates
--   * collapse the two reject states into a single terminal REJECTED
--   * make async disbursement and the repayment phase first-class states
--     (APPROVED -> DISBURSING -> ACTIVE, with DISBURSEMENT_FAILED for retries)

-- Rename the old enum so we can map values across to the new one.
ALTER TYPE "LoanStatus" RENAME TO "LoanStatus_old";

CREATE TYPE "LoanStatus" AS ENUM (
  'PENDING_OFFICER_REVIEW',
  'PENDING_GM_APPROVAL',
  'REJECTED',
  'APPROVED',
  'DISBURSING',
  'DISBURSEMENT_FAILED',
  'ACTIVE'
);

-- The column default references the old type; drop it before converting.
ALTER TABLE "Loan" ALTER COLUMN "status" DROP DEFAULT;

-- Migrate existing loans onto the new lifecycle.
--   * client-online applications awaiting first review  -> PENDING_OFFICER_REVIEW
--   * manual loans previously awaiting officer review    -> PENDING_GM_APPROVAL (new single gate)
--   * officer-approved loans awaiting the GM             -> PENDING_GM_APPROVAL
--   * either reject state                                -> REJECTED
--   * approved + already disbursed (MoMo ref present)    -> ACTIVE
--   * approved but not yet disbursed                     -> APPROVED
ALTER TABLE "Loan"
  ALTER COLUMN "status" TYPE "LoanStatus"
  USING (
    CASE "status"::text
      WHEN 'PENDING' THEN (
        CASE WHEN "source"::text = 'CLIENT_ONLINE'
          THEN 'PENDING_OFFICER_REVIEW'
          ELSE 'PENDING_GM_APPROVAL'
        END
      )
      WHEN 'LOAN_OFFICER_APPROVED' THEN 'PENDING_GM_APPROVAL'
      WHEN 'LOAN_OFFICER_REJECTED' THEN 'REJECTED'
      WHEN 'REJECTED' THEN 'REJECTED'
      WHEN 'APPROVED' THEN (
        CASE WHEN "disbursementReference" IS NOT NULL
          THEN 'ACTIVE'
          ELSE 'APPROVED'
        END
      )
    END::"LoanStatus"
  );

ALTER TABLE "Loan" ALTER COLUMN "status" SET DEFAULT 'PENDING_OFFICER_REVIEW';

-- Migrate the audit log columns. Logs lack the per-row source/disbursement
-- context, so PENDING maps to the officer-review entry point and the GM
-- approval event keeps its APPROVED target.
ALTER TABLE "LoanStatusLog"
  ALTER COLUMN "fromStatus" TYPE "LoanStatus"
  USING (
    CASE "fromStatus"::text
      WHEN 'PENDING' THEN 'PENDING_OFFICER_REVIEW'
      WHEN 'LOAN_OFFICER_APPROVED' THEN 'PENDING_GM_APPROVAL'
      WHEN 'LOAN_OFFICER_REJECTED' THEN 'REJECTED'
      WHEN 'REJECTED' THEN 'REJECTED'
      WHEN 'APPROVED' THEN 'APPROVED'
    END::"LoanStatus"
  );

ALTER TABLE "LoanStatusLog"
  ALTER COLUMN "toStatus" TYPE "LoanStatus"
  USING (
    CASE "toStatus"::text
      WHEN 'PENDING' THEN 'PENDING_OFFICER_REVIEW'
      WHEN 'LOAN_OFFICER_APPROVED' THEN 'PENDING_GM_APPROVAL'
      WHEN 'LOAN_OFFICER_REJECTED' THEN 'REJECTED'
      WHEN 'REJECTED' THEN 'REJECTED'
      WHEN 'APPROVED' THEN 'APPROVED'
    END::"LoanStatus"
  );

DROP TYPE "LoanStatus_old";
