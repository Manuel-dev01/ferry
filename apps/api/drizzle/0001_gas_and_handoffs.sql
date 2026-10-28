CREATE TABLE "gas_topups" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"amount_wei" numeric(78, 0) NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gas_topups_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"tx_hash" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"currency" text NOT NULL,
	"channel" text NOT NULL,
	"block_number" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gas_topups_address_idx" ON "gas_topups" USING btree ("address","created_at");--> statement-breakpoint
CREATE INDEX "handoffs_from_idx" ON "handoffs" USING btree ("from_address");