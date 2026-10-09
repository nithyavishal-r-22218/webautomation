import mysql from 'mysql2/promise';
import { env } from './env';

/**
 * Test accounts from the credentials DB — the TypeScript twin of the Java suite's AccountDB
 * (~/UIautomation core/AccountDB): one row per portalName + portalRole with the login and the OAuth client.
 *
 *   DB_URL / DB_USER / DB_PASSWORD   same variables and defaults as the Java Configuration class
 *   ZP_DB_ROLE_<TARGET>              portalRole for a target, e.g. ZP_DB_ROLE_ADMIN=Admin, ZP_DB_ROLE_CP=cp
 *                                    (unset: the only role equal to the target name, or admin/owner for "admin")
 *
 * Secrets stay in memory: nothing here logs a password, client secret or token.
 */
export interface Account {
  role: string; portalId: string; userName: string; password: string;
  clientId: string; clientSecret: string; refreshToken: string;
}

export const credsTable = () => /localzoho/.test(env.baseUrl) ? 'portalcredslocal' : 'portalcredsidc';

function dbConfig() {
  const url = process.env.DB_URL || 'jdbc:mysql://127.0.0.1:3306/webautomation';
  const m = url.match(/^jdbc:mysql:\/\/([^:/]+)(?::(\d+))?\/([^?]+)/);
  if (!m) throw new Error(`DB_URL must look like jdbc:mysql://host:port/db (got ${url})`);
  return { host: m[1], port: Number(m[2] ?? 3306), database: m[3], user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };
}

export async function account(target: string): Promise<Account> {
  const table = credsTable();
  const conn = await mysql.createConnection(dbConfig());
  try {
    const [roleRows] = await conn.execute(`SELECT portalRole FROM ${table} WHERE portalName = ?`, [env.portal]);
    const roles = (roleRows as { portalRole: string }[]).map(r => r.portalRole);
    if (!roles.length) throw new Error(`No rows in ${table} for portalName='${env.portal}'`);
    const wanted = process.env[`ZP_DB_ROLE_${target.toUpperCase()}`];
    const same = roles.filter(r => r.toLowerCase() === target.toLowerCase());
    const adminLike = target === 'admin' ? roles.filter(r => /admin|owner/i.test(r)) : [];
    const role = wanted ?? (same.length === 1 ? same[0] : adminLike.length === 1 ? adminLike[0] : undefined);
    if (!role || !roles.includes(role))
      throw new Error(`Pick the DB role for "${target}" with ZP_DB_ROLE_${target.toUpperCase()}=<role>. Roles for ${env.portal}: ${roles.join(', ')}`);
    const [rows] = await conn.execute(
      `SELECT portalID, userName, password, clientId, clientSecret, refreshToken FROM ${table} WHERE portalName = ? AND portalRole = ?`,
      [env.portal, role]);
    const r = (rows as Record<string, string>[])[0]!;
    return { role, portalId: String(r.portalID ?? ''), userName: r.userName ?? '', password: r.password ?? '',
      clientId: r.clientId ?? '', clientSecret: r.clientSecret ?? '', refreshToken: r.refreshToken ?? '' };
  } finally {
    await conn.end();
  }
}
