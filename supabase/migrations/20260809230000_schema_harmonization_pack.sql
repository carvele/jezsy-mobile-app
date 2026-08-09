-- Migration: Schema Harmonization Pack
-- Normalizes reservation status and payment_status values to canonical TitleCase,
-- sets defaults, and enforces CHECK constraints.

-- 1. Backfill reservations.status
UPDATE reservations SET status = 'Pending' WHERE LOWER(status) = 'pending';
UPDATE reservations SET status = 'Confirmed' WHERE LOWER(status) = 'confirmed';
UPDATE reservations SET status = 'Ready' WHERE LOWER(status) = 'ready';
UPDATE reservations SET status = 'Active' WHERE LOWER(status) = 'active';
UPDATE reservations SET status = 'Completed' WHERE LOWER(status) = 'completed';
UPDATE reservations SET status = 'Cancelled' WHERE LOWER(status) = 'cancelled';

-- 2. Backfill reservations.payment_status
UPDATE reservations SET payment_status = 'Unpaid' WHERE LOWER(payment_status) = 'unpaid';
UPDATE reservations SET payment_status = 'Deposit Paid' WHERE LOWER(payment_status) = 'deposit_paid' OR LOWER(payment_status) = 'deposit paid';
UPDATE reservations SET payment_status = 'Partially Paid' WHERE LOWER(payment_status) = 'partially_paid' OR LOWER(payment_status) = 'partially paid';
UPDATE reservations SET payment_status = 'Paid' WHERE LOWER(payment_status) = 'paid';
UPDATE reservations SET payment_status = 'Refunded' WHERE LOWER(payment_status) = 'refunded';

-- 3. Set canonical defaults
ALTER TABLE reservations ALTER COLUMN status SET DEFAULT 'Pending';
ALTER TABLE reservations ALTER COLUMN payment_status SET DEFAULT 'Unpaid';

-- 4. Add CHECK constraints
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_status_check 
  CHECK (status IN ('Pending', 'Confirmed', 'Ready', 'Active', 'Completed', 'Cancelled'));

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_payment_status_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_payment_status_check 
  CHECK (payment_status IN ('Unpaid', 'Deposit Paid', 'Partially Paid', 'Paid', 'Refunded'));
