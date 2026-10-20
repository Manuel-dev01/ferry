import type { Context } from 'hono'
import type { z } from 'zod'
import { HttpError } from '../errors'

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Expected a JSON body')
  }
  return parseValue(schema, body)
}

export function parseValue<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)')
    throw new HttpError(400, 'INVALID_REQUEST', 'Some fields are missing or invalid', { fields })
  }
  return parsed.data
}
