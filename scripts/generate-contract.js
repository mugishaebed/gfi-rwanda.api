/**
 * Local helper: generate + attach the loan contract PDFs for a loan via the
 * real LoansService code path (the same one GM approval uses). Needed because
 * loan 70b627 was activated through a raw DB script that skipped this step.
 *
 * Run after `npm run build`:
 *   node --env-file=.env scripts/generate-contract.js
 */
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../dist/app.module');
const { LoansService } = require('../dist/loans/loans.service');

const LOAN_ID = '70b627a9-b143-4e62-94ca-9e3459c35b3f';
const USER_ID = '5111f427-5be0-4506-ad5f-0b4684670a50';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const loans = app.get(LoansService);
    // Private method — invoke via bracket access; this is the exact call GM
    // approval makes at loans.service.ts:544.
    await loans['generateAndAttachLoanContractPdf'](LOAN_ID, USER_ID);
    console.log('Contract generated and attached for loan', LOAN_ID);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
