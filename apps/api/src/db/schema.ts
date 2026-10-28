import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const usdtUnits = (name: string) => bigint(name, { mode: 'bigint' })

export const orderKind = pgEnum('order_kind', [
  'usdt_offramp',
  'ln_mpesa',
  'kes_onramp',
  'test_drive',
])
export const recipientKind = pgEnum('recipient_kind', ['self', 'other'])
export const eventSource = pgEnum('event_source', [
  'user',
  'relayer',
  'webhook',
  'poller',
  'system',
])
export const relayerTxStatus = pgEnum('relayer_tx_status', [
  'pending',
  'mined',
  'replaced',
  'failed',
])
export const rewardKind = pgEnum('reward_kind', [
  'rebate',
  'first_order',
  'referral',
  'test_drive_refund',
])
export const rewardStatus = pgEnum('reward_status', ['queued', 'sent', 'failed'])

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(), // fry_<ulid>
    kind: orderKind('kind').notNull(),
    status: text('status').notNull(),
    statusRank: integer('status_rank').notNull(),

    currency: text('currency'), // NGN | KES | UGX | TZS
    amountUsdt: usdtUnits('amount_usdt'),
    amountToTransfer: usdtUnits('amount_to_transfer'),
    fiatAmount: numeric('fiat_amount', { precision: 20, scale: 2 }),
    rate: numeric('rate', { precision: 20, scale: 6 }),
    ferryFeeUsdt: usdtUnits('ferry_fee_usdt'),

    institutionCode: text('institution_code'),
    recipientMasked: text('recipient_masked'),
    recipientKind: recipientKind('recipient_kind'),

    evmAddress: text('evm_address'),
    nimAddress: text('nim_address'),

    paycrestOrderId: text('paycrest_order_id'),
    receiveAddress: text('receive_address'),
    validUntil: timestamp('valid_until', { withTimezone: true }),

    metaTx: jsonb('meta_tx').$type<{
      nonce: string
      functionSignature: string
      signature: string
    }>(),
    polygonTxHash: text('polygon_tx_hash'),

    lnAddressMasked: text('ln_address_masked'),
    lnInvoice: text('ln_invoice'),
    lnPaymentHash: text('ln_payment_hash'),
    lnAmountMsat: bigint('ln_amount_msat', { mode: 'bigint' }),
    lnVerifyUrl: text('ln_verify_url'),
    nimOrPolygonTxHash: text('nim_or_polygon_tx_hash'),
    swapId: text('swap_id'),

    clientSecretHash: text('client_secret_hash').notNull(),
    deviceHash: text('device_hash'),
    referralCode: text('referral_code'),
    isInternal: boolean('is_internal').notNull().default(false),
    errorCode: text('error_code'),

    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('orders_paycrest_order_id_uq').on(t.paycrestOrderId),
    uniqueIndex('orders_ln_payment_hash_uq').on(t.lnPaymentHash),
    index('orders_status_idx').on(t.status, t.updatedAt),
    index('orders_evm_address_idx').on(t.evmAddress, t.createdAt),
    index('orders_device_hash_idx').on(t.deviceHash, t.createdAt),
  ],
)

/** Append-only status history. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    source: eventSource('source').notNull(),
    payload: jsonb('payload'), // redacted before insert
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
)

export const webhookEvents = pgTable('webhook_events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  provider: text('provider').notNull(),
  eventKey: text('event_key').notNull().unique(), // sha256 of the raw body
  signatureValid: boolean('signature_valid').notNull(),
  body: jsonb('body'), // redacted
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  error: text('error'),
})

export const relayerTxs = pgTable(
  'relayer_txs',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    orderId: text('order_id').references(() => orders.id),
    nonce: integer('nonce').notNull(),
    txHash: text('tx_hash').notNull().unique(),
    maxFee: bigint('max_fee', { mode: 'bigint' }).notNull(),
    priorityFee: bigint('priority_fee', { mode: 'bigint' }).notNull(),
    status: relayerTxStatus('status').notNull().default('pending'),
    createdAt: createdAt(),
    minedAt: timestamp('mined_at', { withTimezone: true }),
  },
  (t) => [index('relayer_txs_order_idx').on(t.orderId)],
)

export const rewards = pgTable(
  'rewards',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    kind: rewardKind('kind').notNull(),
    nimAddress: text('nim_address').notNull(),
    amountLuna: bigint('amount_luna', { mode: 'bigint' }).notNull(),
    status: rewardStatus('status').notNull().default('queued'),
    nimTxHash: text('nim_tx_hash'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('rewards_order_kind_uq').on(t.orderId, t.kind)],
)

export const referrals = pgTable('referrals', {
  code: text('code').primaryKey(),
  ownerEvmAddress: text('owner_evm_address'),
  ownerNimAddress: text('owner_nim_address'),
  uses: integer('uses').notNull().default(0),
  createdAt: createdAt(),
})

/** POL that Ferry's relayer sent so a user's wallet can pay the network fee. Rate-limits top-ups. */
export const gasTopups = pgTable(
  'gas_topups',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    address: text('address').notNull(),
    amountWei: numeric('amount_wei', { precision: 78, scale: 0 }).notNull(),
    txHash: text('tx_hash').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index('gas_topups_address_idx').on(t.address, t.createdAt)],
)

/**
 * A cash-out handed to a payout partner (Fonbnk): the user's own USDT transfer to the partner's
 * deposit address, read back from the chain. No account details are stored.
 */
export const handoffs = pgTable(
  'handoffs',
  {
    txHash: text('tx_hash').primaryKey(),
    provider: text('provider').notNull(),
    fromAddress: text('from_address').notNull(),
    toAddress: text('to_address').notNull(),
    amountUnits: usdtUnits('amount_units').notNull(),
    currency: text('currency').notNull(),
    channel: text('channel').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('handoffs_from_idx').on(t.fromAddress)],
)
