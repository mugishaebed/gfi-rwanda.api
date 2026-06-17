/**
 * Local-only helper: approve a manual loan as GM, replicating the DB state
 * transitions of approveLoanByGeneralManager (PENDING_GM_APPROVAL -> APPROVED
 * -> ACTIVE with disbursement fields + audit logs). Skips the contract-PDF and
 * notification side effects, which aren't needed for local testing. Bypasses the
 * "GM must differ from originator" guard for the same-email local setup.
 */
import { Pool } from 'pg';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DIRECT_URL or DATABASE_URL must be set');
const pool = new Pool({ connectionString });

const LOAN_ID = '70b627a9-b143-4e62-94ca-9e3459c35b3f';

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, status, source, "userId", amount
         FROM "Loan" WHERE id = $1 FOR UPDATE`,
      [LOAN_ID],
    );
    const loan = rows[0];
    if (!loan) throw new Error(`Loan ${LOAN_ID} not found`);
    if (loan.status !== 'PENDING_GM_APPROVAL') {
      throw new Error(
        `Loan is in status ${loan.status}, expected PENDING_GM_APPROVAL`,
      );
    }

    const gm = loan.userId; // same user acts as GM in local setup
    const now = new Date();

    // PENDING_GM_APPROVAL -> APPROVED
    await client.query(
      `INSERT INTO "LoanStatusLog" (id, "loanId", "fromStatus", "toStatus", "changedBy", note, "createdAt")
       VALUES (gen_random_uuid(), $1, 'PENDING_GM_APPROVAL', 'APPROVED', $2, $3, $4)`,
      [LOAN_ID, gm, 'GM approval (local script)', now],
    );
    await client.query(
      `UPDATE "Loan" SET status = 'APPROVED', "updatedAt" = $2 WHERE id = $1`,
      [LOAN_ID, now],
    );

    // APPROVED -> ACTIVE (manual disbursement recorded on GM approval)
    await client.query(
      `INSERT INTO "LoanStatusLog" (id, "loanId", "fromStatus", "toStatus", "changedBy", note, "createdAt")
       VALUES (gen_random_uuid(), $1, 'APPROVED', 'ACTIVE', $2, $3, $4)`,
      [LOAN_ID, gm, 'Manual disbursement recorded on GM approval', now],
    );
    await client.query(
      `UPDATE "Loan"
          SET status = 'ACTIVE',
              "activatedAt" = $2,
              "disbursedAt" = $2,
              "disbursedAmount" = $3,
              "updatedAt" = $2
        WHERE id = $1`,
      [LOAN_ID, now, loan.amount],
    );

    await client.query('COMMIT');

    const { rows: after } = await client.query(
      `SELECT id, status, "disbursedAmount", "disbursedAt", "activatedAt", "outstandingBalance"
         FROM "Loan" WHERE id = $1`,
      [LOAN_ID],
    );
    console.log('Approved & activated:');
    console.log(JSON.stringify(after[0], null, 2));
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
