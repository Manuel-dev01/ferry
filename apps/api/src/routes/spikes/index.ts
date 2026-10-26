import { Hono } from 'hono'
import type { AppEnv, Deps } from '../../app'
import { s2Routes } from './s2-gasless'
import { s3Routes } from './s3-lightning'
import { s4Routes } from './s4-nimiq'
import { s5Routes } from './s5-gateway'

/** Phase 0 experiments. Mounted only when SPIKES_ENABLED=true. */
export function spikeRoutes(deps: Deps) {
  const r = new Hono<AppEnv>()
  r.route('/', s2Routes(deps))
  r.route('/', s3Routes(deps))
  r.route('/', s4Routes())
  r.route('/', s5Routes(deps))
  return r
}
