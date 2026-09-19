import type { EvalRow } from './types'

/**
 * A one-table stand-in for Prisma, holding exactly the calls
 * lib/llm/enrichment.ts makes: `emailMessage.findUnique`, `.update`,
 * `.updateMany` (the "store a recovered OTP only while extractedOtp is still
 * null" guard) and the array form of `$transaction`. It is the only thing faked
 * in the eval: the extraction, the prompt, the provider, acceptLlmOtp and the
 * category/CTA merge all run for real. Rows are cloned in and out, so a caller
 * mutating what it got cannot corrupt the store.
 *
 * When lib/llm/enrichment.ts starts making another Prisma call this store must
 * learn it too, or the harness fails with "is not a function" on that path —
 * the pipeline self-test (pipeline.selftest.ts) is what catches it.
 */
export class RowStore {
  private rows = new Map<string, EvalRow>()

  clear(): void {
    this.rows.clear()
  }

  insert(row: EvalRow): void {
    this.rows.set(row.id, structuredClone(row))
  }

  get(id: string): EvalRow | undefined {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : undefined
  }

  prismaShim() {
    return {
      emailMessage: {
        findUnique: async ({ where }: { where: { id: string } }): Promise<EvalRow | null> =>
          this.get(where.id) ?? null,
        update: async ({
          where,
          data,
        }: {
          where: { id: string }
          data: Partial<EvalRow>
        }): Promise<EvalRow> => {
          const row = this.rows.get(where.id)
          if (!row) throw new Error(`RowStore: no row with id ${where.id}`)
          Object.assign(row, structuredClone(data))
          return structuredClone(row)
        },
        /**
         * Equality filters only, which is all enrichment uses (`{ id,
         * extractedOtp: null }`). Anything richer would need real query
         * semantics, so it throws rather than quietly matching the wrong rows.
         */
        updateMany: async ({
          where,
          data,
        }: {
          where: Partial<Record<keyof EvalRow, unknown>>
          data: Partial<EvalRow>
        }): Promise<{ count: number }> => {
          const filters = Object.entries(where)
          if (filters.some(([, value]) => typeof value === 'object' && value !== null)) {
            throw new Error('RowStore.updateMany only supports equality filters')
          }
          let count = 0
          for (const row of this.rows.values()) {
            const record = row as unknown as Record<string, unknown>
            if (filters.every(([key, value]) => record[key] === value)) {
              Object.assign(row, structuredClone(data))
              count += 1
            }
          }
          return { count }
        },
      },
      /**
       * Array form only. The operations were already started when they were
       * passed in (the `update` above runs eagerly), so all that is left to model
       * is "they settle together". There is no rollback: if a later operation
       * rejects, an earlier one's write stays — a difference from a real
       * transaction that does not matter for judging what enrichment produced.
       */
      $transaction: async (operations: unknown): Promise<unknown[]> => {
        if (!Array.isArray(operations)) {
          throw new Error('RowStore.$transaction only supports the array form')
        }
        return Promise.all(operations)
      },
    }
  }
}
