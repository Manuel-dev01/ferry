const KEY = 'ferry.uncertain-transfers.v1'
const memory = new Set<string>()

function saved(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return new Set(
      Array.isArray(value)
        ? value.filter((a): a is string => typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a))
        : [],
    )
  } catch {
    return new Set()
  }
}

/** An unknown broadcast must survive navigation/reload until the user checks wallet activity. */
export function hasUncertainTransfer(address: string): boolean {
  return memory.has(address.toLowerCase()) || saved().has(address.toLowerCase())
}
export function markUncertainTransfer(address: string) {
  const key = address.toLowerCase()
  memory.add(key)
  const values = saved()
  values.add(key)
  try {
    localStorage.setItem(KEY, JSON.stringify([...values]))
  } catch {
    /* memory lasts this visit */
  }
}
export function clearUncertainTransfer(address: string) {
  const key = address.toLowerCase()
  memory.delete(key)
  const values = saved()
  values.delete(key)
  try {
    localStorage.setItem(KEY, JSON.stringify([...values]))
  } catch {
    /* retain conservative saved flag */
  }
}
