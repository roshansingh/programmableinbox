import type { EvalRow } from './types'

/**
 * A one-table stand-in for Prisma, holding exactly the calls
 * lib/llm/enrichment.ts makes (`emailMessage.findUnique` and `.update`). It is
 * the only thing faked in the eval: the extraction, the prompt, the provider,
 * acceptLlmOtp and the category/CTA merge all run for real. Rows are cloned in
 * and out, so a caller mutating what it got cannot corrupt the store.
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
      },
    }
  }
}
