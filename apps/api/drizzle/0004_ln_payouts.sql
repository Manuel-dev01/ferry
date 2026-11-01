CREATE TABLE "ln_payouts" (
	"payment_hash" text PRIMARY KEY NOT NULL,
	"route" text NOT NULL,
	"country" text NOT NULL,
	"channel" text NOT NULL,
	"fiat_amount" bigint NOT NULL,
	"sats" bigint NOT NULL,
	"amount_units" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"receipt" text
);
--> statement-breakpoint
CREATE INDEX "ln_payouts_pending_idx" ON "ln_payouts" USING btree ("delivered_at","created_at");