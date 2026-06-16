/**
 * GFI Rwanda — Loan API types for the frontend.
 *
 * Generated to match the backend after the loan-lifecycle changes
 * (separate officer/GM gates, source-based disbursement, ACTIVE state).
 * Drop into your frontend and adjust the import paths / nested shapes as needed.
 *
 * Money values are numbers (RWF). Dates are ISO strings in responses
 * (YYYY-MM-DD for date-only fields, full ISO timestamps otherwise) and may be
 * sent as YYYY-MM-DD strings in requests.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Enums
 * ──────────────────────────────────────────────────────────────────────── */

/** Raw workflow status of a loan (the `status`/`workflowStatus` field). */
export enum LoanStatus {
  /** Client-submitted application awaiting loan-officer review. */
  PENDING_OFFICER_REVIEW = 'PENDING_OFFICER_REVIEW',
  /** Awaiting GM approval (manual loans start here; online loans arrive after officer approval). */
  PENDING_GM_APPROVAL = 'PENDING_GM_APPROVAL',
  /** Terminal: rejected by officer or GM (stage is recorded in the status log). */
  REJECTED = 'REJECTED',
  /** GM-authorized, money not yet moved. Transient for online loans. */
  APPROVED = 'APPROVED',
  /** Online only: MoMo payout in flight, awaiting provider callback. */
  DISBURSING = 'DISBURSING',
  /** Online only: MoMo payout failed; eligible for retry by the GM. */
  DISBURSEMENT_FAILED = 'DISBURSEMENT_FAILED',
  /** Disbursed and in the repayment phase. */
  ACTIVE = 'ACTIVE',
}

export enum LoanSource {
  CLIENT_ONLINE = 'CLIENT_ONLINE',
  STAFF_MANUAL = 'STAFF_MANUAL',
}

/** Economic sector a manual loan belongs to (used for filtering + insights). */
export enum LoanSector {
  COFFEE = 'COFFEE',
  GENERAL_TRADE = 'GENERAL_TRADE',
  CONSTRUCTION = 'CONSTRUCTION',
  REAL_ESTATE = 'REAL_ESTATE',
  TENDERS = 'TENDERS',
  HOSPITALITY = 'HOSPITALITY',
}

/** Human-friendly labels for the sector enum. */
export const LOAN_SECTOR_LABELS: Record<LoanSector, string> = {
  [LoanSector.COFFEE]: 'Coffee',
  [LoanSector.GENERAL_TRADE]: 'General Trade',
  [LoanSector.CONSTRUCTION]: 'Construction',
  [LoanSector.REAL_ESTATE]: 'Real Estate',
  [LoanSector.TENDERS]: 'Tenders',
  [LoanSector.HOSPITALITY]: 'Hospitality',
};

export enum DisbursementMethod {
  MOBILE_MONEY = 'MOBILE_MONEY',
}

export enum RepaymentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Normalized, client-facing status returned to the CLIENT app in the `status`
 * field (the raw enum is in `workflowStatus`). Unchanged by the migration.
 */
export type ClientFacingLoanStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'overdue'
  | 'rejected';

/** Status groups that are still awaiting money/decision, for staff filters. */
export const PRE_ACTIVE_STATUSES: LoanStatus[] = [
  LoanStatus.PENDING_OFFICER_REVIEW,
  LoanStatus.PENDING_GM_APPROVAL,
  LoanStatus.APPROVED,
  LoanStatus.DISBURSING,
  LoanStatus.DISBURSEMENT_FAILED,
];

/* ────────────────────────────────────────────────────────────────────────
 * Shared building blocks
 * ──────────────────────────────────────────────────────────────────────── */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export interface RepaymentScheduleItem {
  installmentNo: number;
  dueDate: string; // YYYY-MM-DD
  amount: number;
}

export interface RepaymentTerms {
  currency: string;
  installmentsCount: number;
  amountPerInstallment: number;
  periodMonths: number;
  paymentDayOfMonth: number;
  schedule: RepaymentScheduleItem[];
}

export interface LoanStatusLog {
  id: string;
  loanId: string;
  fromStatus: LoanStatus;
  toStatus: LoanStatus;
  /** User id, or a system sentinel like "system:momo-callback" / "system:migration". */
  changedBy: string;
  note: string | null;
  createdAt: string;
}

export interface LoanDocument {
  id: string;
  ownerType: 'LOAN';
  ownerId: string;
  label: string;
  originalFileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** Download URL or storage key, depending on your documents service config. */
  url?: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Request bodies
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * POST /loans  (role: LOAN_OFFICER) — create a manual loan.
 * Sent as multipart/form-data when attaching `documents` files.
 * NOTE: `disbursedAmount` / `disbursedAt` were REMOVED here — they are decided
 * by the GM at approval (see ReviewLoanRequest).
 */
export interface CreateManualLoanRequest {
  clientId: string;
  amount: number;
  purpose: string;
  /** Required for manual loans. */
  sector: LoanSector;
  interestRatePercentPerMonth: number;
  termInMonths: number;
  termStartDate: string; // YYYY-MM-DD
  termEndDate: string; // YYYY-MM-DD
  disbursementWithinDays: number;
  collateralType: string;
  collateralEstimatedValue: number;
  collateralLocation: string;
  repaymentInstallmentsCount: number;
  repaymentAmountPerMonth: number;
  repaymentPeriodMonths: number;
  paymentDayOfMonth: number; // 1..31
  loanProcessingFeePercent: number;
  administrativeFeePercent: number;
  loanApplicationFeePercent: number;
  earlyRepaymentFeePercent: number;
  defaultPenaltyFeePercentPerDay: number;
  spouseName?: string;
  repaymentTerms: RepaymentTerms;
  guarantorInfo?: Record<string, unknown>;
  comments?: string;
  documentLabels?: string[];
  // documents: File[] — attach under the "documents" multipart field
}

/**
 * POST /loans/request and POST /clients/.. (role: CLIENT) — quick client loan.
 * Several fields are fixed constants the backend validates strictly.
 */
export interface ClientLoanRequest {
  amount: number; // 100..500000
  currency: 'RWF';
  termInMonths: 1;
  termsAccepted: true;
  termsVersion: 'loan-request-v1';
  disbursementMethod: DisbursementMethod;
}

/**
 * Body for officer/GM review actions:
 *   POST /loans/:id/officer-approve | officer-reject
 *   POST /loans/:id/approve | reject   (GM)
 *
 * `disbursedAmount` / `disbursedAt` apply ONLY to MANUAL loans on GM approve;
 * they are ignored for online loans and for reject actions.
 */
export interface ReviewLoanRequest {
  note?: string;
  /** Manual loans only: GM-decided net amount disbursed. Defaults to loan amount. */
  disbursedAmount?: number;
  /** Manual loans only: date funds were handed over. Defaults to approval time. */
  disbursedAt?: string; // YYYY-MM-DD
}

/* ────────────────────────────────────────────────────────────────────────
 * Staff / admin responses  (GET /loans, GET /loans/:id, review endpoints)
 * ──────────────────────────────────────────────────────────────────────── */

/** Abridged — extend with the client profile fields your UI actually renders. */
export interface LoanClientSummary {
  id: string;
  email?: string;
  phoneNumber?: string;
  individual?: { fullName: string; nationalId?: string } | null;
  business?: { businessName: string; registrationNumber?: string } | null;
}

export interface LoanOfficerSummary {
  id: string;
  name?: string | null;
  email?: string | null;
}

/** Full loan object returned to staff (LOAN_OFFICER / GENERAL_MANAGER). */
export interface StaffLoan {
  id: string;
  loanNumber: string;
  clientId: string;
  amount: number;
  currency: string;
  purpose: string;
  status: LoanStatus;
  source: LoanSource;
  /** Null for client quick-loans and legacy loans created before sectors existed. */
  sector: LoanSector | null;

  interestRatePercentPerMonth: number;
  termInMonths: number;
  termStartDate: string;
  termEndDate: string;
  disbursementWithinDays: number;

  collateralType: string;
  collateralEstimatedValue: number;
  collateralLocation: string;

  repaymentInstallmentsCount: number;
  repaymentAmountPerMonth: number;
  repaymentPeriodMonths: number;
  paymentDayOfMonth: number;
  repaymentTerms: RepaymentTerms;

  loanProcessingFeePercent: number;
  administrativeFeePercent: number;
  loanApplicationFeePercent: number;
  earlyRepaymentFeePercent: number;
  defaultPenaltyFeePercentPerDay: number;

  outstandingBalance: number;
  totalRepaidAmount: number;
  totalInterestExpected: number | null;
  totalInterestReceived: number;
  totalPrincipalRecovered: number;

  disbursementMethod: DisbursementMethod;
  disbursementReference: string | null;
  disbursedAmount: number | null;
  disbursedAt: string | null;
  activatedAt: string | null;

  spouseName: string | null;
  guarantorInfo: Record<string, unknown> | null;
  comments: string | null;

  /** Originator: manual creator, or the officer who reviewed an online loan. */
  userId: string | null;
  createdAt: string;
  updatedAt: string;

  client: LoanClientSummary;
  user: LoanOfficerSummary | null;
  statusLogs: LoanStatusLog[];
  documents?: LoanDocument[];
}

export type StaffLoanListResponse = Paginated<StaffLoan>;

/** GET /loans query params. `status`, `source`, `sector` use the raw enums. */
export interface StaffLoanListQuery {
  page?: number;
  limit?: number;
  status?: LoanStatus;
  source?: LoanSource;
  sector?: LoanSector;
}

/** One row of GET /loans/insights/sectors. */
export interface SectorInsight {
  sector: LoanSector;
  totalLoans: number;
  activeLoans: number;
  /** Anything before disbursement completes (review/approval/disbursing). */
  pendingLoans: number;
  rejectedLoans: number;
  totalAmount: number;
  totalDisbursed: number;
  outstandingBalance: number;
  totalRepaid: number;
}

/** GET /loans/insights/sectors response (OFFICER/GM). One entry per sector. */
export interface SectorInsightsResponse {
  sectors: SectorInsight[];
}

/** One row of the GM manual-loan ledger (GET /loans/manual-ledger). */
export interface ManualLedgerRow {
  no: string; // client account number
  loanNumber: string;
  customerName: string;
  sector: LoanSector | null;
  loanApproved: number; // amount
  disbursedAmount: number | null;
  outstanding: number;
  disbursementDate: string | null; // YYYY-MM-DD
  periodMonths: number;
  interestRate: number; // percent per month
  totalInterestToBeEarned: number | null;
  interestReceived: number;
  principalRecovered: number;
  // Extras (not in the sheet) for row keys / navigation / context:
  loanId: string;
  status: LoanStatus;
}

/** Summed totals over the whole filtered set (not just the current page). */
export interface ManualLedgerTotals {
  loanApproved: number;
  disbursedAmount: number;
  outstanding: number;
  totalInterestToBeEarned: number;
  interestReceived: number;
  principalRecovered: number;
}

/** GET /loans/manual-ledger response (LOAN_OFFICER / GENERAL_MANAGER). */
export interface ManualLedgerResponse {
  data: ManualLedgerRow[];
  totals: ManualLedgerTotals;
  meta: PaginationMeta;
}

/** GET /loans/manual-ledger query params. */
export interface ManualLedgerQuery {
  page?: number;
  limit?: number;
  sector?: LoanSector;
}

/* ────────────────────────────────────────────────────────────────────────
 * Client app responses
 * ──────────────────────────────────────────────────────────────────────── */

/** POST /loans/request response. */
export interface ClientLoanRequestResponse {
  data: {
    id: string;
    loanNumber: string;
    amount: number;
    currency: string;
    purpose: string;
    status: ClientFacingLoanStatus;
    workflowStatus: LoanStatus;
    totalRepayment: number;
    interest: number;
    interestRatePercentPerMonth: number;
    termInMonths: number;
    termStartDate: string;
    termEndDate: string;
    paymentDayOfMonth: number;
    repaymentAmountPerMonth: number;
    repaymentTerms: RepaymentTerms;
    disbursementMethod: DisbursementMethod;
    disbursementPhone: string; // masked
    createdAt: string;
    updatedAt: string;
  };
}

/** Item in GET /clients/me/loans. */
export interface ClientLoanListItem {
  id: string;
  loanNumber: string;
  amount: number;
  currency: string;
  purpose: string;
  status: ClientFacingLoanStatus;
  workflowStatus: LoanStatus;
  remainingBalance: number;
  totalPayable: number;
  interest: number;
  nextPayment: {
    dueDate: string;
    amount: number;
    status: 'overdue' | 'pending';
  } | null;
  createdAt: string;
}

export type ClientLoanListResponse = Paginated<ClientLoanListItem>;

/** GET /clients/me/loans?status= uses the client-facing strings, not the enum. */
export interface ClientLoanListQuery {
  page?: number;
  limit?: number;
  status?: ClientFacingLoanStatus;
}

/** GET /clients/me/loans/:id. */
export interface ClientLoanDetail {
  id: string;
  loanNumber: string;
  amount: number;
  currency: string;
  purpose: string;
  status: ClientFacingLoanStatus;
  workflowStatus: LoanStatus;
  trackerStep: 'Application' | 'Repayment' | 'Completed' | 'Rejected';
  interest: number;
  totalPayable: number;
  remainingBalance: number;
  repaymentSchedule: Array<{
    installmentNo?: number;
    dueDate: string;
    amount: number;
    status: 'Paid' | 'Overdue' | 'Pending';
  }>;
  paymentHistory: Array<{
    paidAt: string;
    amount: number;
    method: string;
    reference: string;
    status: RepaymentStatus;
  }>;
  officerNotes: Array<{ id: string; message: string; createdAt: string }>;
}

/** GET /clients/me/loan-dashboard. */
export interface ClientLoanDashboard {
  activeLoan: number;
  outstandingBalance: number;
  nextPaymentDate: string | null;
  daysRemaining: number;
  loansCount: number;
  recentLoans: Array<{
    id: string;
    loanNumber: string;
    amount: number;
    currency: string;
    status: ClientFacingLoanStatus;
    workflowStatus: LoanStatus;
    createdAt: string;
  }>;
}

/** GET /clients/me/loan-offer. */
export interface ClientLoanOffer {
  availableLimit: number;
  minimumRequest: number;
  currency: string;
  interestRatePercent: number;
  termMonths: number;
  termsVersion: string;
  disbursementMethod: DisbursementMethod;
  disbursementPhone: string; // masked
  expectedReviewHours: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Endpoint reference (method · path · role · body → response)
 * ────────────────────────────────────────────────────────────────────────
 *
 *  GET    /loans                         OFFICER,GM   StaffLoanListQuery  → StaffLoanListResponse
 *  GET    /loans/insights/sectors        OFFICER,GM                       → SectorInsightsResponse
 *  GET    /loans/manual-ledger           OFFICER,GM   ManualLedgerQuery   → ManualLedgerResponse
 *  GET    /loans/:id                     OFFICER,GM                       → StaffLoan
 *  POST   /loans                         OFFICER      CreateManualLoanRequest (multipart) → StaffLoan   [→ PENDING_GM_APPROVAL]
 *  POST   /loans/request                 CLIENT       ClientLoanRequest (multipart)       → ClientLoanRequestResponse  [→ PENDING_OFFICER_REVIEW]
 *  POST   /loans/:id/officer-approve     OFFICER      ReviewLoanRequest  → StaffLoan      [PENDING_OFFICER_REVIEW → PENDING_GM_APPROVAL]
 *  POST   /loans/:id/officer-reject      OFFICER      ReviewLoanRequest  → StaffLoan      [PENDING_OFFICER_REVIEW → REJECTED]
 *  POST   /loans/:id/approve             GM           ReviewLoanRequest  → StaffLoan      [PENDING_GM_APPROVAL → APPROVED → (manual) ACTIVE | (online) DISBURSING]
 *  POST   /loans/:id/reject              GM           ReviewLoanRequest  → StaffLoan      [PENDING_GM_APPROVAL → REJECTED]
 *  POST   /loans/:id/retry-disbursement  GM           {}                 → StaffLoan      [DISBURSEMENT_FAILED → DISBURSING]
 *
 *  GET    /clients/me/loan-offer         CLIENT                          → ClientLoanOffer
 *  GET    /clients/me/loans              CLIENT       ClientLoanListQuery → ClientLoanListResponse
 *  GET    /clients/me/loans/:id          CLIENT                          → ClientLoanDetail
 *  GET    /clients/me/loan-dashboard     CLIENT                          → ClientLoanDashboard
 *
 *  Key 400s to handle:
 *   - GM approve where approver === loan.userId (originator): "must be different from the loan officer who originated it"
 *   - approve/reject/officer-* from a status the transition map disallows
 *   - retry-disbursement when status !== DISBURSEMENT_FAILED
 *   - repayment endpoints when loan status !== ACTIVE
 */
