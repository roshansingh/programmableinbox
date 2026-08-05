/**
 * Tool result shapes for the MCP surface (issue #104).
 *
 * The split between these two and a JSON-RPC protocol error is the contract
 * from the design note, and it is not cosmetic. A JSON-RPC error means *the
 * request was not something this server can process* — an unknown tool, a
 * malformed envelope — and clients surface it as a transport failure. An
 * `isError: true` tool result means *the call was well-formed and the answer is
 * "no"*, and it goes back to the model as text it can act on.
 *
 * Everything a caller could plausibly fix by calling differently — a missing
 * scope, an inbox that is not visible, a bad cursor, a search parameter over
 * its cap — belongs in the second category, phrased so that the next call can
 * be the right one. `jsonError(message, status)` on the REST side maps here.
 */

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/**
 * A successful result, as compact JSON.
 *
 * Not pretty-printed: indentation is billed to the caller's context window at
 * roughly a token per line of whitespace, and no model needs it to read JSON.
 */
export function toolResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] }
}

/**
 * A failed call the model may be able to correct.
 *
 * Takes a plain sentence rather than an error object because the reader is a
 * model deciding what to do next, and a stack trace or an error code tells it
 * nothing actionable.
 */
export function toolError(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
