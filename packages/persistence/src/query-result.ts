/**
 * TypeORM's PostgreSQL driver returns raw UPDATE/DELETE results as
 * `[returnedRows, affectedRowCount]`, while SELECT/INSERT results are returned
 * as a flat row array. Keep that driver-specific shape at this boundary so
 * stores never accidentally treat the tuple itself as a database row.
 */
export function queryRows<T>(result: unknown): T[] {
  if (!Array.isArray(result)) {
    throw new TypeError('Expected a PostgreSQL raw query result array');
  }

  if (result.length === 2 && Array.isArray(result[0]) && typeof result[1] === 'number') {
    return result[0] as T[];
  }

  return result as T[];
}
