# Automation Editor — Drag-and-Drop Palette and Node-Level Add Affordance

**Status:** Approved — awaiting implementation plan
**Date:** 2026-05-11
**Branch:** `feat/email-automations-definitions`

## Summary

Replace the current top-bar "Add Condition / Add Action" buttons with two new affordances that work side by side:

1. A **hover-revealed "+" button** on the right edge of trigger and condition node cards. Clicking it opens a picker popover that adds the chosen block as a child of that node.
2. A **left-rail palette sidebar** inside the flow card. Each block type is a draggable card. Dropping it on a trigger or condition auto-attaches the new node as a child; dropping it on the canvas creates a free-floating node at the drop position; dropping it on an action node is rejected.

Both surfaces share a single catalog covering five block types: **Condition**, **Forward Email**, **Send Webhook**, **Auto Reply**, **Add Tag**. Action nodes never get a "+" because they cannot have children.

The existing top-toolbar "Add Condition" / "Add Action" buttons are removed.

## Why

The current editor has three problems this spec resolves:

- **No action-type picker.** Today, clicking "Add Action" hardcodes the new node to `send_webhook` (`editor-state.ts:115`). The other three action types (`forward_email`, `auto_reply`, `add_tag`) are fully implemented at the schema, executor, and form level, but unreachable through the UI short of editing JSON.
- **Add operations require a select-then-click ritual.** The two top buttons depend on having a source node selected. The flow has no per-node affordance, so users selecting a target and looking for a "what comes next" hint don't find one.
- **No spatial node creation.** Users cannot freehand place nodes on the canvas; everything must extend an existing parent. That makes it hard to sketch a flow before wiring it up.

This spec keeps everything that already works (config-first model, BFS fallback layout, validation rules, dispatcher gating) and adds the affordances above.

## Scope

### In scope (v1)

- `lib/automations/block-catalog.ts` — typed catalog of pickable block types.
- `components/automations/node-picker.tsx` — popover-content component used by the hit-area "+".
- `components/automations/palette-sidebar.tsx` — left-rail palette with draggable items.
- Hover-revealed `+` button on `TriggerNode` and `ConditionNode` cards (right edge, anchored outside the card body).
- Auto-open the node-config sheet after a new node is created via either path.
- HTML5 drag-and-drop into the React Flow canvas with coordinate translation via `useReactFlow().screenToFlowPosition`.
- Drop-on-node smart-attach: drop on a valid source = create + auto-connect as child; drop on action = rejected with a toast; drop on canvas = free-floating node at drop coordinates.
- New `editor-state.addFreeNode(config, layout, { key, position })` helper.
- New parameter on `editor-state.addChildNode`: explicit `key` (no more hardcoded webhook).
- Removal of the top toolbar "Add Condition / Add Action" buttons.
- Zod refinement on `forward_email_config` requiring `to.length >= 1`, so the editor flags incomplete forward nodes the same way it flags webhooks with an empty URL.
- Tests covering picker, palette, drop, hit-area click, and catalog/schema parity.

### Explicitly out of scope (v1)

- Dropping a palette item onto an existing edge to splice in a new node.
- Changing a node's action type after creation (e.g. converting a webhook node into a forward-email node in the config sheet).
- Custom drag previews or animated drop indicators (using browser-default drag ghost).
- Highlighting valid drop targets while dragging (target validation happens at drop time via a toast on rejection).
- Touch/mobile DnD (HTML5 DnD does not reliably cover touch — mobile users fall back to the hit-area "+" which works on tap).
- New action types beyond the four already implemented.
- Reordering palette items via user preference.

## Architecture

### Single source of truth: the block catalog

A new module `lib/automations/block-catalog.ts` exports a typed catalog describing every pickable block type:

```ts
export type BlockKey =
  | 'condition'
  | 'forward_email'
  | 'send_webhook'
  | 'auto_reply'
  | 'add_tag'

export type BlockCatalogEntry = {
  key: BlockKey
  group: 'logic' | 'action'
  label: string
  description: string
  icon: LucideIcon
  createNode: (id: string) => AutomationNodeConfig
}

export const blockCatalog: Record<BlockKey, BlockCatalogEntry>
export const blockCatalogList: BlockCatalogEntry[]
export const ALL_BLOCK_KEYS: BlockKey[] // = blockCatalogList.map((e) => e.key)
```

Each entry's `createNode` returns a fresh node config with empty/placeholder values. The catalog is the only module that knows how to construct a default node from a UI affordance. Adding a new block type later means adding one entry to this catalog — no editor or palette changes needed.

`editor-state.createConditionNode` and `editor-state.createActionNode` (the existing private helpers that hardcode webhook defaults) move into the catalog as `createNode` implementations and are deleted from `editor-state.ts`.

### New components

#### `components/automations/node-picker.tsx`

Popover content component. Props:

```ts
type NodePickerProps = {
  allowedKeys: BlockKey[]
  onPick: (key: BlockKey) => void
}
```

Renders the allowed catalog entries grouped into two sections: **Logic** and **Actions**. Each row shows icon + label + 1-line description. Clicking a row calls `onPick(key)`.

For v1, `allowedKeys` is the same set (`['condition', 'forward_email', 'send_webhook', 'auto_reply', 'add_tag']`) for both trigger and condition sources, since both accept the same children. The parameter exists so that future source types (e.g. action nodes that gain branching) can filter the picker without changing the component.

#### `components/automations/palette-sidebar.tsx`

Left-rail vertical palette. Fixed width 192px. Renders the same catalog entries grouped Logic/Actions, with each entry as a draggable card showing icon + label.

Drag mechanic: native HTML5 drag-and-drop.

```ts
function handleDragStart(event: React.DragEvent, key: BlockKey) {
  event.dataTransfer.setData('application/x-automation-block', key)
  event.dataTransfer.setData('text/plain', key) // a11y fallback
  event.dataTransfer.effectAllowed = 'copy'
}
```

The palette itself does not handle drops; the canvas handles them.

### Modified components

#### `components/automations/automation-editor.tsx`

Layout: the existing single-column flow card becomes a two-column grid (`grid-cols-[192px_1fr]`). The first column is the palette; the second is the React Flow canvas card.

Removed: the top toolbar `<Button>Add Condition</Button>` and `<Button>Add Action</Button>`. The `canAddChildren` derived value is no longer needed at the editor level (each node decides for itself whether to render its "+" affordance) and is deleted.

Added:

- A drop zone wrapping the React Flow canvas. The wrapper handles `onDragOver` (prevent default, set `dropEffect = 'copy'`) and `onDrop`. The drop handler reads the block key from the dataTransfer, computes flow-space coordinates via `useReactFlow().screenToFlowPosition`, and dispatches to one of:
  - `addChildNode(config, { sourceNodeId, nodeKind, key })` if the drop target is a valid source node.
  - `addFreeNode(config, layout, { key, position })` if dropped on empty canvas.
  - Toast and no-op if dropped on an action node.
- A `handlePickBlock(sourceNodeId, key)` callback passed through React Flow's node data to trigger/condition nodes so their picker popovers can invoke it.
- A `lastAddedNodeId` ref. After `reconcile`, if `lastAddedNodeId.current` is set, the editor sets `selectedNodeId` to that id and clears the ref. This triggers the existing `NodeConfigSheet` to open (it's controlled by `selectedNodeId`).

#### `components/automations/nodes/trigger-node.tsx` and `condition-node.tsx`

Each gains a hover/select-revealed "+" button anchored to the right edge of the card, ~12px outside the card boundary. Implemented with Tailwind's `group/node` hover scope:

```tsx
<div className="group/node ...">
  <Card>...</Card>
  <div className="absolute right-[-32px] top-1/2 -translate-y-1/2
                  opacity-0 group-hover/node:opacity-100
                  data-[selected=true]:opacity-100
                  transition-opacity">
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="outline" className="h-6 w-6 rounded-full">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" className="w-72 p-0">
        <NodePicker
          allowedKeys={ALL_BLOCK_KEYS}
          onPick={(key) => onPickBlock(data.configNodeId, key)}
        />
      </PopoverContent>
    </Popover>
  </div>
</div>
```

`onPickBlock` comes from a small React Context (`AutomationEditorContext`) provided at the editor level and consumed by the trigger/condition node components. We deliberately do **not** thread the callback through React Flow's node `data` — node data is reused across renders and putting a function there would either churn nodes on every render or stale-close over old state. The context exposes `{ onPickBlock(sourceNodeId, key) }`. Selection state for the affordance is read from React Flow's `selected` boolean on the node.

`action-node.tsx` is **not** modified — actions cannot have children.

### Editor-state helper changes

`components/automations/editor-state.ts`:

- `addChildNode(config, params)` — `params` becomes `{ sourceNodeId, key: BlockKey }`. The function:
  1. Validates the source can add children (same trigger/condition check as today).
  2. Validates `key` is allowed for that source (currently same set, but uses `allowedKeys` from catalog for forward-compat).
  3. Calls `blockCatalog[key].createNode(newId)` for the new node config.
  4. Inserts the node and a new edge from `sourceNodeId`.
  5. Returns `{ config: nextConfig, newNodeId }` instead of just config — callers need the id to auto-open the config sheet.
- New `addFreeNode(config, layout, { key, position })`:
  1. Generates a new node id via the same `createNodeId` helper.
  2. Calls `blockCatalog[key].createNode(newId)`.
  3. Returns `{ config: nextConfig, layout: nextLayout, newNodeId }` with the layout position written immediately at the drop coordinates. We write the position eagerly here (unlike `addChildNode` which leans on the BFS fallback) because a free-floating node has no graph context — there's no fallback to anchor it to.
- The private `createConditionNode` and `createActionNode` helpers are deleted; the catalog owns these.

### Schema change (forward-email)

`lib/automations/schemas.ts`:

- `forward_email_config`'s `to` array gains `.min(1, 'at least one recipient is required')`.

This ensures the validator surfaces incomplete forward-email nodes the same way it would surface a webhook with an empty URL. The form (`forward-email-form.tsx`) already lets users edit `to` as a comma-separated list; nothing changes there.

## Data flow

### Hit-area click flow

```text
User hovers trigger/condition node
  → "+" affordance fades in
User clicks "+"
  → NodePicker popover opens, anchored right of node
User clicks "Forward Email"
  → handlePickBlock(sourceId, 'forward_email') called
  → addChildNode(config, { sourceNodeId: sourceId, key: 'forward_email' })
  → returns { config: nextConfig, newNodeId }
  → editor sets lastAddedNodeId.current = newNodeId
  → editor calls reconcile(nextConfig, layout)
  → editor effect: selectedNodeId = newNodeId
  → NodeConfigSheet opens for the new node
  → User fills `to` field; validation passes when `to.length >= 1`
```

### DnD flow (drop on source node)

```text
User mousedowns on "Forward Email" palette card → drags
  → dragstart sets dataTransfer
User drags over a condition node, releases
  → drop event fires on canvas wrapper
  → handler reads key from dataTransfer
  → event.target.closest('[data-id]') finds the condition node
  → getConfigNode(config, dataId) returns the condition (valid source)
  → addChildNode(config, { sourceNodeId, key }) called
  → identical to hit-area path from here on
```

### DnD flow (drop on empty canvas)

```text
User drags "Forward Email" → releases over empty canvas area
  → drop handler finds no node at the target
  → screenToFlowPosition translates cursor coordinates
  → addFreeNode(config, layout, { key, position })
  → reconcile sets nodes/edges, layout already has position baked in
  → selectedNodeId = newNodeId, config sheet opens
  → validation reports `disconnected_node`, canStart = false
  → user wires the node up by drawing an edge from its parent
```

### DnD flow (drop on action node)

```text
User drags onto an action node → releases
  → drop handler finds the action node
  → action type rejects drop
  → toast: "Action blocks cannot have children"
  → no config or layout changes
```

## Error handling and validation

- **Invalid drops** are rejected at drop time with a toast. No partial state is committed.
- **DataTransfer integrity:** if `dataTransfer.getData('application/x-automation-block')` returns an empty string or a value not in `blockCatalog`, the drop is silently rejected. This guards against drag operations originating from outside the palette (e.g. browser-native text drag).
- **Coordinate translation failure:** if `screenToFlowPosition` returns `null/undefined` (it shouldn't under normal conditions), the drop is rejected with a toast `"Could not determine drop location"`.
- **Free-floating node validation:** existing `disconnected_node` validation rule (`validation.ts:134`) flags the new node, `canStart` becomes false, Start button is disabled until the user wires it up. No new validation code.
- **Empty forward-email `to`:** the new Zod refinement rejects the config at save time. Until then the editor's runtime validator surfaces the issue via the existing validation panel.
- **No new server-side error handling:** all changes are client-only. API contracts unchanged.

## Testing

### New test files

- `lib/automations/__tests__/block-catalog.test.ts`
  - Every catalog entry's `createNode(id)` produces a config that passes the relevant schema (forward-email node passes `actionNodeSchema`, etc.).
  - Each entry has a unique `key`; `group` is `'logic'` or `'action'`.
  - Iterating `blockCatalogList` returns the same set as `Object.values(blockCatalog)`.

- `components/__tests__/node-picker.test.tsx`
  - Renders all 5 items when `allowedKeys` is the full set.
  - Items are grouped under "Logic" and "Actions" headings.
  - Respects `allowedKeys` filtering (passing only `['condition']` hides the action items).
  - Clicking a row calls `onPick(key)` once with the right key.

- `components/__tests__/palette-sidebar.test.tsx`
  - Renders draggable items for each catalog entry (`draggable=true`, `data-block-key=<key>`).
  - `dragstart` populates `dataTransfer` with the `application/x-automation-block` MIME type and correct key.
  - Renders Logic / Actions section headings.

### Updated test files

- `lib/automations/__tests__/editor-state.test.ts`
  - Existing `addChildNode` call sites (currently passing `{ sourceNodeId, nodeKind }`) are updated to the new signature `{ sourceNodeId, key }`.
  - Assertions on the resulting node's `actionType` now check the key matches what was passed instead of assuming `send_webhook`.
  - Add a test that `addChildNode` returns `{ config, newNodeId }`.
  - Add a test for `addFreeNode` that the layout has the dropped position written and the node is in the config but not in any edge.

- `components/__tests__/automation-editor.test.tsx`
  - Existing tests that reference the top "Add Condition" / "Add Action" buttons (test names: `disables add actions when an action node is selected`, `adds a connected child node from the selected source and enables connections`) are rewritten:
    - Replace "click Add X button" with "click the hit-area + on the source node, then click the picker item".
    - The "disables add actions" test becomes "action node does not render a + affordance" since action nodes simply have no plus button (no disabled state to assert).
  - Four new tests:
    1. **Hit-area picker on trigger** — open + popover on the trigger, click "Forward Email", assert a new forward-email action node is added and connected, config sheet opens for it.
    2. **Hit-area picker on condition** — same as above but on a condition node; pick "Add Tag".
    3. **DnD onto trigger node** — fire `dragstart` on a palette item, then `drop` event on the trigger's DOM element. Mock `screenToFlowPosition`. Assert the new node is created and connected.
    4. **DnD onto empty canvas** — fire `drop` on the canvas pane (no node target). Assert a free-floating node exists, has the dropped coordinates in layout, and `validation.canStart === false` due to `disconnected_node`.

### Test-harness notes

- jsdom does not support real HTML5 DnD events. Tests use `fireEvent.dragStart` / `fireEvent.drop` with a hand-built `dataTransfer` mock, following the standard React Flow testing pattern.
- `useReactFlow().screenToFlowPosition` is mocked per-test to return deterministic coordinates.
- No new MSW handlers needed; all changes are client-only.

## Files changed (summary)

### New

- `lib/automations/block-catalog.ts`
- `components/automations/node-picker.tsx`
- `components/automations/palette-sidebar.tsx`
- `lib/automations/__tests__/block-catalog.test.ts`
- `components/__tests__/node-picker.test.tsx`
- `components/__tests__/palette-sidebar.test.tsx`

### Modified

- `components/automations/automation-editor.tsx` — add palette column, drop handler, remove top buttons, add lastAddedNodeId ref + auto-open sheet
- `components/automations/nodes/trigger-node.tsx` — add hover-revealed + button + picker popover
- `components/automations/nodes/condition-node.tsx` — same
- `components/automations/editor-state.ts` — update `addChildNode` signature, add `addFreeNode`, delete inline node-creation helpers
- `lib/automations/schemas.ts` — add `.min(1)` refinement on `forward_email_config.to`
- `lib/automations/__tests__/editor-state.test.ts` — update `addChildNode` call sites, add `addFreeNode` coverage
- `components/__tests__/automation-editor.test.tsx` — rewrite top-button assertions, add hit-area and DnD tests

### Unchanged (explicit)

- `components/automations/nodes/action-node.tsx` — actions never get a "+"
- `lib/automations/graph.ts` — fallback BFS layout still used by `addChildNode`
- `lib/automations/validation.ts` — existing rules suffice
- All API routes
- `lib/automations/dispatcher.ts`, `executor.ts`, `actions.ts`

## Risks and open questions

- **HTML5 DnD ergonomics across browsers:** Chrome and Firefox both support the API we need; Safari has known quirks around `dropEffect`. We'll smoke-test in Safari during implementation and document any limitations. Touch users fall back to the hit-area "+" which has no DnD dependency.
- **Picker popover anchored to off-card "+":** the "+" sits 12px outside the card. On extreme zoom-out the affordance can land outside the React Flow viewport. Acceptable for v1 since the default 75% zoom keeps cards centered; we can revisit if it bites.
- **Auto-opening the config sheet on every creation** may feel intrusive when users want to add several nodes quickly. We'll measure during dogfood; a future option could be to only auto-open for action nodes (where empty defaults always need filling) and skip auto-open for conditions.

## Acceptance criteria

- Top toolbar shows Start, Duplicate, Dry Run, Save Layout, Save Automation — no Add buttons.
- A draggable left-rail palette appears inside the flow card with Logic and Actions sections.
- Hovering a trigger or condition node reveals a "+" on the right edge; clicking it opens a picker with 5 items grouped Logic / Actions.
- Clicking a picker item creates a new node connected as a child of the source; the node-config sheet opens automatically for the new node.
- Dragging a palette item onto a trigger or condition node auto-attaches the new node as a child.
- Dragging a palette item onto an action node shows a toast `"Action blocks cannot have children"` and creates nothing.
- Dragging a palette item onto empty canvas creates a free-floating node at the drop position; `Start` becomes disabled with a `disconnected_node` validation issue until the user wires it up.
- A new forward-email node with an empty `to` list shows a validation error and `canStart === false` until the user fills in at least one recipient.
- All existing tests still pass; new tests cover catalog parity, picker, palette DnD source, hit-area click, and the four DnD drop scenarios.
