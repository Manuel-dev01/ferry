CREATE TABLE "nim_swaps" (
	"swap_id" text PRIMARY KEY NOT NULL,
	"claim_tx" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nim_swaps_claim_tx_unique" UNIQUE("claim_tx")
);
