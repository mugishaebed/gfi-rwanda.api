-- Add roles column as array, defaulting to LOAN_OFFICER
ALTER TABLE "User" ADD COLUMN "roles" "UserRole"[] NOT NULL DEFAULT ARRAY['LOAN_OFFICER'::"UserRole"];

-- Copy existing single role into the new array column
UPDATE "User" SET "roles" = ARRAY["role"::"UserRole"];

-- Drop the old single-value column
ALTER TABLE "User" DROP COLUMN "role";
