import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { fileURLToPath } from 'node:url'
import { createDb } from './client'

// Migrations prefer a direct (unpooled) connection; the app itself uses the pooled one.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const { db, sql } = createDb(url)
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
await sql.end()
console.warn('Migrations applied')
