import { createRequire } from 'node:module'

let patched = false

type JsonStatement = {
  column: string
  value: unknown
}

type QueryCompiler = {
  _columnClause(statement: JsonStatement): string
  client: {
    parameter(value: unknown, builder: unknown, holder: unknown): string
  }
  builder: unknown
  bindingsHolder: unknown
}

/**
 * Queue claims use SKIP LOCKED, which SQLite does not implement.
 * These tests run one job at a time, so the lock clause is a no-op.
 * Date bindings and JSON superset checks are also rewritten to match
 * the text timestamps and JSON documents Lucid stores.
 */
export function allowSqliteQueueLocks() {
  if (patched) {
    return
  }
  patched = true
  const nodeRequire = createRequire(import.meta.url)
  const compiler = nodeRequire('knex/lib/dialects/sqlite3/query/sqlite-querycompiler.js')
  compiler.prototype.skipLocked = function skipLocked() {
    return ''
  }
  const client = nodeRequire('knex/lib/dialects/better-sqlite3/index.js')
  client.prototype._formatBindings = function formatBindings(bindings: unknown[] | undefined) {
    if (!bindings) {
      return []
    }
    return bindings.map((binding) => {
      if (binding instanceof Date) {
        return formatDate(binding)
      }
      if (typeof binding === 'boolean') {
        return Number(binding)
      }
      return binding
    })
  }
  compiler.prototype.whereJsonSupersetOf = function whereJsonSupersetOf(
    this: QueryCompiler,
    statement: JsonStatement
  ) {
    const column = this._columnClause(statement)
    const encoded = JSON.stringify(statement.value)
    const expected = this.client.parameter(encoded, this.builder, this.bindingsHolder)
    const actual = this.client.parameter(encoded, this.builder, this.bindingsHolder)
    const contained = `json_extract(${column}, '$.' || expected.key) = expected.value`
    return `(SELECT count(*) FROM json_each(${expected})) = (SELECT count(*) FROM json_each(${actual}) AS expected WHERE ${contained})`
  }
}

function formatDate(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  const year = value.getFullYear()
  const month = pad(value.getMonth() + 1)
  const day = pad(value.getDate())
  const hours = pad(value.getHours())
  const minutes = pad(value.getMinutes())
  const seconds = pad(value.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}
