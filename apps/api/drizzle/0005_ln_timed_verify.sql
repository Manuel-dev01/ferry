ALTER TABLE "ln_payouts" ADD COLUMN "timed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ln_payouts" ADD COLUMN "verify_url" text;