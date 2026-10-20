CREATE TYPE "public"."event_source" AS ENUM('user', 'relayer', 'webhook', 'poller', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('usdt_offramp', 'ln_mpesa', 'kes_onramp', 'test_drive');--> statement-breakpoint
CREATE TYPE "public"."recipient_kind" AS ENUM('self', 'other');--> statement-breakpoint
CREATE TYPE "public"."relayer_tx_status" AS ENUM('pending', 'mined', 'replaced', 'failed');--> statement-breakpoint
CREATE TYPE "public"."reward_kind" AS ENUM('rebate', 'first_order', 'referral', 'test_drive_refund');--> statement-breakpoint
CREATE TYPE "public"."reward_status" AS ENUM('queued', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"source" "event_source" NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "order_kind" NOT NULL,
	"status" text NOT NULL,
	"status_rank" integer NOT NULL,
	"currency" text,
	"amount_usdt" bigint,
	"amount_to_transfer" bigint,
	"fiat_amount" numeric(20, 2),
	"rate" numeric(20, 6),
	"ferry_fee_usdt" bigint,
	"institution_code" text,
	"recipient_masked" text,
	"recipient_kind" "recipient_kind",
	"evm_address" text,
	"nim_address" text,
	"paycrest_order_id" text,
	"receive_address" text,
	"valid_until" timestamp with time zone,
	"meta_tx" jsonb,
	"polygon_tx_hash" text,
	"ln_address_masked" text,
	"ln_invoice" text,
	"ln_payment_hash" text,
	"ln_amount_msat" bigint,
	"ln_verify_url" text,
	"nim_or_polygon_tx_hash" text,
	"swap_id" text,
	"client_secret_hash" text NOT NULL,
	"device_hash" text,
	"referral_code" text,
	"is_internal" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"code" text PRIMARY KEY NOT NULL,
	"owner_evm_address" text,
	"owner_nim_address" text,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relayer_txs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text,
	"nonce" integer NOT NULL,
	"tx_hash" text NOT NULL,
	"max_fee" bigint NOT NULL,
	"priority_fee" bigint NOT NULL,
	"status" "relayer_tx_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"mined_at" timestamp with time zone,
	CONSTRAINT "relayer_txs_tx_hash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"kind" "reward_kind" NOT NULL,
	"nim_address" text NOT NULL,
	"amount_luna" bigint NOT NULL,
	"status" "reward_status" DEFAULT 'queued' NOT NULL,
	"nim_tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_key" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"body" jsonb,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relayer_txs" ADD CONSTRAINT "relayer_txs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_paycrest_order_id_uq" ON "orders" USING btree ("paycrest_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_ln_payment_hash_uq" ON "orders" USING btree ("ln_payment_hash");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "orders_evm_address_idx" ON "orders" USING btree ("evm_address","created_at");--> statement-breakpoint
CREATE INDEX "orders_device_hash_idx" ON "orders" USING btree ("device_hash","created_at");--> statement-breakpoint
CREATE INDEX "relayer_txs_order_idx" ON "relayer_txs" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rewards_order_kind_uq" ON "rewards" USING btree ("order_id","kind");