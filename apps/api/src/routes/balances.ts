import { evmAddressSchema, type BalancesResponse } from '@ferry/shared'
import { Hono } from 'hono'
import { getAddress } from 'viem'
import type { AppEnv, Deps } from '../app'
import { HttpError } from '../errors'
import { readBalances } from '../polygon'
import { parseValue } from './validate'

export function balancesRoutes(deps: Deps) {
  const r = new Hono<AppEnv>()

  // Reads go through our own Polygon RPC so the wallet never has to switch chains.
  r.get('/balances/:address', async (c) => {
    const address = getAddress(parseValue(evmAddressSchema, c.req.param('address')))
    let balances
    try {
      balances = await readBalances(deps.polygon, deps.env.USDT0_ADDRESS as `0x${string}`, address)
    } catch (err) {
      c.get('log').warn({ err }, 'balance read failed')
      throw new HttpError(503, 'RPC_UNAVAILABLE', "We couldn't reach the Polygon network")
    }
    const body: BalancesResponse = {
      address,
      usdt: balances.usdt.toString(),
      pol: balances.pol.toString(),
    }
    return c.json(body)
  })

  return r
}
