# GFI Rwanda API

Backend service for the GFI Rwanda lending workflow, built with NestJS and Prisma.

This project supports internal loan operations, Microsoft-based staff authentication, client management, loan lifecycle tracking, and repayment handling for both digitally submitted and manually entered records.

## Overview

The API is designed around two main ideas:

- staff access is authenticated through Microsoft and authorized with role-based permissions
- lending operations are centered on clients, loans, repayments, and review/approval steps

The codebase currently includes modules for:

- authentication
- users
- clients
- loans
- repayments
- notifications

The application uses:

- `NestJS` for the API framework
- `Prisma` for database access
- `PostgreSQL` as the database
- `Passport JWT` for access-token protection
- `Microsoft Entra / Azure AD` login through `@azure/msal-node`
- `Scalar API Reference` for interactive development documentation

## Business Context

This system reflects the GFI Rwanda operational process for managing borrowers and loans. It supports both online and offline workflows, but the internal staff process is especially important for this backend.

### Flow B: Internal Process

From the system flow provided, the internal process works like this:

1. A Loan Officer registers a client internally.
   Key client information includes full name, national ID, phone number, address, employment details, and income information.

2. The Loan Officer creates a loan for that client.
   The record includes the loan amount, purpose, repayment terms, and officer comments or analysis.

3. The loan moves to management review.
   A General Manager reviews the client and loan details, adds comments where needed, and either approves or rejects the request.

4. Once approved, the loan becomes active.
   The system begins tracking the active loan lifecycle.

5. For offline clients, repayments can be entered manually by staff.
   Manual repayment capture includes amount paid, payment date, and payment method.

6. Repayment records can be reviewed and approved by management.
   This preserves operational control over manually entered financial activity.

This flow is reflected in the domain structure of the backend:

- `User` represents internal staff
- `Client` represents the borrower record
- `Loan` represents the financing record
- `LoanStatusLog` captures status changes
- `Repayment` tracks payment activity

## Roles and Responsibilities

The current system defines two staff roles:

- `LOAN_OFFICER`
- `GENERAL_MANAGER`

Loan Officers are responsible for operational work such as:

- registering clients
- creating and updating records
- entering internal loan data
- recording manual repayments

General Managers are responsible for supervisory actions such as:

- approving or rejecting loan decisions
- reviewing workflow outcomes
- controlling higher-level decision steps

Authorization is enforced with route guards and role metadata.

## API Documentation

Interactive documentation is available in development mode.

When the app is running locally, the documentation is exposed at:

- `/docs`

The docs are generated from Nest Swagger metadata and rendered through Scalar.

The current documentation setup includes:

- request body documentation from DTOs
- grouped controller sections
- bearer-auth support for secured routes

## Data Model Summary

The Prisma schema currently centers on these entities:

- `User`
  Internal staff account with Microsoft identity linkage, role, and refresh-token state

- `Client`
  Shared base record for all borrowers

- `IndividualClient`
  Individual borrower profile data

- `BusinessClient`
  Business borrower profile data, including shareholders and registration details

- `Loan`
  Loan record linked to a client and optionally to the staff user handling it

- `LoanStatusLog`
  Audit trail for loan status transitions

- `Repayment`
  Payment records associated with loans

Enums in the schema define controlled values such as:

- user roles
- client type
- business type
- loan status
- repayment status

## Project Structure

```text
src/
  auth/
  clients/
  loans/
  repayments/
  notifications/
  users/
  generated/
  prisma.service.ts
  main.ts

prisma/
  schema.prisma

certificates/
  ca.pem
```

### Structure Notes

- `src/auth` handles Microsoft login, JWT issuance, refresh-token rotation, guards, and roles
- `src/clients` contains DTOs, controller logic, and client service operations
- `src/generated/prisma` contains the generated Prisma client
- `src/prisma.service.ts` creates the Prisma client using the PostgreSQL adapter
- `prisma/schema.prisma` defines the application data model

## Getting Started

### Prerequisites

- Node.js
- pnpm
- PostgreSQL database access
- Microsoft Entra application credentials
- database CA certificate if your provider requires TLS verification

### Install Dependencies

```bash
pnpm install
```

### Environment Variables

Create a `.env` file with values for the following:

```env
NODE_ENV=development

DATABASE_URL=
DIRECT_URL=
SHADOW_DATABASE_URL=

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=

JWT_SECRET=
JWT_EXPIRES_IN=1d
REFRESH_TOKEN_EXPIRES_IN_DAYS=30

FRONTEND_URL=
PORT=3000
```

### Database Notes

This project is configured for Prisma with PostgreSQL and currently reads the datasource URL from `prisma.config.ts`.

If your database requires a custom CA certificate, make sure the connection string includes the proper SSL settings. For example:

```env
DIRECT_URL=postgres://user:password@host:port/db?sslmode=verify-full&sslrootcert=/absolute/path/to/certificates/ca.pem
```

The project already includes a local `certificates/` directory for this purpose.

### Generate Prisma Client

```bash
pnpm exec prisma generate
```

### Apply Schema Changes

Use one of the following depending on your workflow:

```bash
pnpm exec prisma db push
```

or

```bash
pnpm exec prisma migrate dev
```

### Start the Application

```bash
pnpm start:dev
```

By default, the API runs on:

- `http://localhost:3000`

## Available Scripts

```bash
pnpm build
pnpm start
pnpm start:dev
pnpm start:debug
pnpm start:prod
pnpm lint
pnpm test
pnpm test:watch
pnpm test:cov
pnpm test:e2e
```

## Development Notes

### Versioning

URI versioning is enabled globally, with version `v1` as the default API version.

### CORS

CORS is currently enabled with an open origin policy for development.

### Prisma Configuration

Prisma configuration is defined in `prisma.config.ts`, and the datasource URL is loaded from environment variables rather than being hardcoded in the Prisma schema file.

## Security Notes

- Do not commit real secrets to version control
- Rotate any credential that has been exposed in logs or screenshots
- Keep `JWT_SECRET` strong and private
- Prefer short-lived access tokens and revocable refresh tokens
- Protect database connections with TLS where required

## Current Scope

The backend already has the foundations for:

- staff authentication and authorization
- client registration and updates
- internal loan workflow support
- repayment tracking
- refresh-token session renewal
- API documentation for development

Some modules are still scaffolds and will grow as business logic is added.

## Contributing

When extending the project:

- keep DTO validation and Swagger documentation in sync
- update the Prisma schema carefully and regenerate the client
- preserve role-based guard behavior
- document any major workflow or auth changes here in the README

## License

This project is currently marked `UNLICENSED`.
