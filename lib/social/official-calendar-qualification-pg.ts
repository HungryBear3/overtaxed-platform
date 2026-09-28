import { Client } from "pg";
import {
  OWNED_KEYS,
  type QualificationDb,
  type ResolvedTarget,
  type RowFact,
  type SchemaFacts,
} from "@/lib/social/official-calendar-qualification";

/**
 * node-postgres adapter for [[createQualificationHarness]]. Connects from
 * discrete, already-validated fields — never from the raw URL — so no URL
 * option can re-route the session after validation. Hosted targets verify TLS
 * against the supplied project CA; only a loopback rehearsal runs without TLS.
 *
 * `createdAt` and the clock are both read as nominal epoch milliseconds in the
 * server's default session time zone, the same zone the store's inserts use.
 */
export function pgQualificationDb(
  resolved: ResolvedTarget,
): () => Promise<QualificationDb> {
  const { target, password, caPem } = resolved;
  return async () => {
    const client = new Client({
      host: target.host,
      port: target.port,
      database: target.database,
      user: target.user,
      password,
      ssl: caPem
        ? { rejectUnauthorized: true, ca: caPem, servername: target.host }
        : false,
      application_name: "ot-calendar-preview-qualification",
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
    });
    await client.connect();
    const one = async <T>(text: string, values: unknown[] = []) =>
      (await client.query(text, values)).rows as T[];
    return {
      async identity() {
        const [row] = await one<{
          databaseName: string;
          marker: string | null;
        }>(
          `select current_database() as "databaseName", shobj_description(d.oid, 'pg_database') as marker
             from pg_database d where d.datname = current_database()`,
        );
        return {
          databaseName: row?.databaseName ?? "",
          marker: row?.marker ?? null,
        };
      },
      async schema(): Promise<SchemaFacts> {
        const columns = await one<{
          name: string;
          dataType: string;
          nullable: boolean;
        }>(
          `select column_name as name, data_type as "dataType", is_nullable = 'YES' as nullable
             from information_schema.columns
            where table_schema = 'public' and table_name = 'SystemConfig' order by ordinal_position`,
        );
        if (!columns.length)
          return {
            columns,
            uniqueKeyIndex: false,
            privileges: {
              select: false,
              insert: false,
              update: false,
              delete: false,
            },
          };
        const [facts] = await one<{
          unique: boolean;
          select: boolean;
          insert: boolean;
          update: boolean;
          delete: boolean;
        }>(
          `select exists (
                    select 1 from pg_index i
                      join pg_class t on t.oid = i.indrelid
                      join pg_namespace n on n.oid = t.relnamespace
                      join pg_attribute a on a.attrelid = t.oid and a.attnum = i.indkey[0]
                     where n.nspname = 'public' and t.relname = 'SystemConfig'
                       and i.indisunique and i.indnkeyatts = 1 and i.indpred is null
                       and a.attname = 'key') as "unique",
                  has_table_privilege('public."SystemConfig"', 'SELECT') as "select",
                  has_table_privilege('public."SystemConfig"', 'INSERT') as "insert",
                  has_table_privilege('public."SystemConfig"', 'UPDATE') as "update",
                  has_table_privilege('public."SystemConfig"', 'DELETE') as "delete"`,
        );
        return {
          columns,
          uniqueKeyIndex: facts?.unique === true,
          privileges: {
            select: facts?.select === true,
            insert: facts?.insert === true,
            update: facts?.update === true,
            delete: facts?.delete === true,
          },
        };
      },
      async clockMs() {
        const [row] = await one<{ ms: string }>(
          `select floor(extract(epoch from localtimestamp) * 1000)::bigint::text as ms`,
        );
        return Number(row?.ms);
      },
      async epochMs() {
        const [row] = await one<{ ms: string }>(
          `select floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text as ms`,
        );
        return Number(row?.ms);
      },
      async rows(keys: readonly string[]): Promise<RowFact[]> {
        const rows = await one<{
          id: string;
          key: string;
          value: string;
          created: string;
        }>(
          `select "id", "key", "value", floor(extract(epoch from "createdAt") * 1000)::bigint::text as created
             from "SystemConfig" where "key" = any($1::text[]) order by "key", "id"`,
          [[...keys]],
        );
        return rows.map((r) => ({
          id: r.id,
          key: r.key,
          value: r.value,
          createdAtMs: Number(r.created),
        }));
      },
      async deleteOwned(rows, sinceMs) {
        if (!rows.length) return 0;
        // The key allowlist is fixed here too: no caller can widen what is deleted.
        const result = await client.query(
          `delete from "SystemConfig" s
            using unnest($1::text[], $2::text[]) as owned(key, id)
            where s."key" = owned.key and s."id" = owned.id
              and s."key" = any($3::text[])
              and floor(extract(epoch from s."createdAt") * 1000) >= $4::bigint`,
          [
            rows.map((r) => r.key),
            rows.map((r) => r.id),
            [...OWNED_KEYS],
            sinceMs,
          ],
        );
        return result.rowCount ?? 0;
      },
      async close() {
        await client.end();
      },
    };
  };
}
