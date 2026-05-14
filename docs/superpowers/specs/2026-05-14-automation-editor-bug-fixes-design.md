# Automation Editor — Bug Fix Pass (bug-1.md)

**Status:** Approved — awaiting implementation plan
**Date:** 2026-05-14
**Branch:** `feat/email-automations-definitions`
**Source bug list:** `docs/bugs/bug-1.md`

## Summary

Fix five user-reported bugs in the automation editor that surfaced after the drag-and-drop palette and node-level "+" picker landed:

1. The "+" picker popover opens and closes immediately. Replace with a centered Dialog (modal) showing the existing `NodePicker` content.
2. After closing the node config drawer and clicking the same node again, the drawer does not reopen. Caused by React Flow's internal `selected` flag staying `true` after our `selectedNodeId` clears. Fix by clearing both stores on close.
3. Edge delete via select + Delete key is not wired. Add `onEdgesDelete` handler that mutates `config.edges`.
4. Node delete via select + Delete key is not wired. Trigger nodes must remain undeletable. The drawer needs an explicit Delete button. Edges connected to a deleted node should cascade (existing `deleteNodeCascade` handles this).
5. Save must validate the graph and refuse to persist incomplete or invalid graphs. The validator already checks graph shape, connection legality, reachability, dangling edges, and per-node Zod parse. Wire the Save Automation button to its `canStart` flag.

The reiterated connection constraints (one trigger, trigger→action/logic, logic→action, action terminal, multiple connections allowed) are already enforced by `isValidConnection` and `validateAutomationGraph`. No constraint logic changes.

## Why

After the drag-and-drop feature shipped, manual testing revealed three interaction defects (1, 2) and three policy gaps (3, 4, 5). The defects make the editor feel broken; the policy gaps let users persist graphs the dispatcher cannot run.

## Scope

### In scope

- Replace the "+" popover with a `<Dialog>` in `trigger-node.tsx` and `condition-node.tsx`.
- Add `handleSheetOpenChange` that clears both `selectedNodeId` and React Flow's per-node `selected` flag.
- Wire `onEdgesDelete` and `onNodesDelete` callbacks.
- Block trigger deletion via `deletable: false` on the compiled flow node.
- Add a Delete button to `NodeConfigSheet` for non-trigger nodes.
- Extend `AutomationEditorContext` with `onDeleteBlock(nodeId)`.
- Gate the Save Automation button on `validation.canStart`.
- Tests for each of the above.

### Out of scope

- Undo/redo for delete operations.
- Confirm dialog before delete (rely on the fact that cascade only prunes already-unreachable nodes; users can re-add via picker).
- Multi-select node move/group operations beyond what React Flow ships natively.
- Drag-edge-to-rewire affordance.
- Search/filter inside the picker modal (5 items today).
- Allowing partial-draft saves despite validation errors (user explicitly asked to block).
- Any change to the connection-rule constraints — they are already enforced.

## Architecture

### Bug 1 — popover → Dialog

Root cause: the current `<Popover>` lives inside a React Flow node. React Flow listens for pointer events on the canvas and on nodes; Radix's `<Popover>` uses an outside-click detector that interprets React Flow's pointer handling as "outside the popover," so the popover closes the same tick it opens.

Fix: swap `<Popover>` / `<PopoverTrigger>` / `<PopoverContent>` for `<Dialog>` / `<DialogTrigger>` / `<DialogContent>` from `@/components/ui/dialog`. The Dialog renders into a portal with its own backdrop and focus trap; React Flow's pointer events never reach the modal's outside-detection logic.

Each node component (`TriggerNode`, `ConditionNode`) keeps its hover-revealed "+" button anchored at `-right-8`, but the button is now a `<DialogTrigger asChild>`. A local `useState<boolean>` controls open state so `onPick` can call `setOpen(false)` after the user picks an item:

```tsx
const [pickerOpen, setPickerOpen] = useState(false)
const { onPickBlock } = useAutomationEditor()

return (
  <div className="group/node relative" data-selected={selected ? 'true' : 'false'}>
    <Card>...</Card>
    <Handle type="source" position={Position.Right} id="next" className="..." />
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <DialogTrigger asChild>
        <Button ... data-testid={`add-block-${id}`}><Plus className="h-3 w-3" /></Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a block</DialogTitle>
        </DialogHeader>
        <NodePicker
          allowedKeys={ALL_BLOCK_KEYS}
          onPick={(key) => {
            onPickBlock(id, key)
            setPickerOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  </div>
)
```

### Bug 2 — sheet re-open after close

Root cause: when the Sheet closes via X button, our `selectedNodeId` is set to `null`, but React Flow tracks its own `selected: boolean` per node. The Node retains `selected: true` internally. Some click paths after that don't fire a fresh `onNodeClick` because React Flow may suppress identical-selection events.

Fix: when the sheet's `onOpenChange(false)` fires, clear both stores. The same logic applies when `onPaneClick` is the close path. Implement a single `handleSheetOpenChange`:

```ts
function handleSheetOpenChange(open: boolean) {
  if (open) return
  setSelectedNodeId(null)
  setNodes((current) => current.map((n) => ({ ...n, selected: false })))
}
```

Pass it as `onOpenChange` to `<NodeConfigSheet>`. Replace the existing `onPaneClick={() => setSelectedNodeId(null)}` with `onPaneClick={() => handleSheetOpenChange(false)}` so both close paths converge.

### Bug 3 — edge delete

Wire React Flow's `onEdgesDelete` callback in `<ReactFlow>`:

```ts
function handleEdgesDelete(deleted: Edge[]) {
  if (deleted.length === 0) return
  const ids = new Set(deleted.map((e) => e.id))
  const nextConfig = {
    ...config,
    edges: config.edges.filter((e) => !ids.has(e.id)),
  }
  reconcile(nextConfig, layout)
  setConfigDirty(true)
}
```

React Flow handles the Delete keypress natively; the callback just propagates the mutation into our canonical config.

Edge-delete intentionally does **not** prune disconnected nodes. The user may be rewiring; the disconnected node will appear in the validation panel and block save until they re-connect or delete it.

### Bug 4 — node delete + cascade + drawer button + trigger blocked

Three pieces:

**(a) Trigger un-deletable.** In `lib/automations/graph.ts`, the `compileAutomationGraph` function sets `deletable` on each compiled node:

```ts
{
  id: node.id,
  type: ...,
  deletable: node.type !== 'trigger',
  position,
  data: {...}
}
```

Add `deletable?: boolean` to `AutomationFlowNode` in `lib/automations/types.ts`. React Flow respects `deletable: false` and silently ignores Delete keypresses on the trigger.

**(b) Wire `onNodesDelete`.** In `automation-editor.tsx`:

```ts
function handleNodesDelete(deleted: Node[]) {
  if (deleted.length === 0) return
  let nextConfig = config
  for (const node of deleted) {
    nextConfig = deleteNodeCascade(nextConfig, node.id)
  }
  if (nextConfig === config) return
  reconcile(nextConfig, layout)
  setConfigDirty(true)
}
```

`deleteNodeCascade` (already in `editor-state.ts`) removes the node, removes connected edges, and prunes anything no longer reachable from the trigger.

**(c) Drawer Delete button.** Extend `AutomationEditorContext`:

```ts
export type AutomationEditorContextValue = {
  onPickBlock: (sourceNodeId: string, key: BlockKey) => void
  onDeleteBlock: (nodeId: string) => void
}
```

In `automation-editor.tsx`:

```ts
const handleDeleteBlock = useCallback(
  (nodeId: string) => {
    const nextConfig = deleteNodeCascade(config, nodeId)
    if (nextConfig === config) return
    reconcile(nextConfig, layout)
    setSelectedNodeId(null)
    setConfigDirty(true)
  },
  [config, layout, reconcile]
)
```

In `NodeConfigSheet`, render a Delete button in the header when `node.type !== 'trigger'`:

```tsx
<SheetHeader className="flex flex-row items-start justify-between gap-3">
  <div>
    <SheetTitle>{title}</SheetTitle>
    <SheetDescription>{description}</SheetDescription>
  </div>
  {node && node.type !== 'trigger' ? (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      onClick={() => onDeleteBlock(node.id)}
      data-testid="delete-block"
    >
      <Trash2 className="mr-1 h-4 w-4" />
      Delete
    </Button>
  ) : null}
</SheetHeader>
```

`onDeleteBlock` is consumed via `useAutomationEditor()` inside `NodeConfigSheet`.

### Bug 5 — save validation

Disable the Save Automation button when validation fails:

```tsx
<Button
  onClick={saveAutomation}
  disabled={
    isSaving ||
    (!configDirty && !layoutDirty) ||
    !validation.canStart
  }
  title={!validation.canStart ? 'Fix validation errors before saving' : undefined}
>
  <Save className="mr-2 h-4 w-4" />
  Save Automation
</Button>
```

The validation panel above the canvas already enumerates every issue (the existing `validation.issues` block at `automation-editor.tsx:313-328`). Combined with the disabled button + tooltip, the user has both the why and the what.

No new validation rules — existing coverage:
- exactly-one-trigger
- trigger has no incoming, action has no outgoing
- disconnected nodes blocked (dangling node)
- edges referencing missing nodes blocked (dangling edge)
- at least one reachable action
- no self-loops, no duplicate edges
- per-node Zod parse (empty `forward_email.to`, empty webhook URL, etc.) — emits `node_config_invalid`

Save Layout is unaffected: positions can always persist, even with an incomplete graph.

## Files changed

### Modified

- `components/automations/nodes/trigger-node.tsx` — Popover → Dialog, local open state.
- `components/automations/nodes/condition-node.tsx` — same.
- `components/automations/automation-editor.tsx`:
  - `handleSheetOpenChange` (Bug 2)
  - `handleEdgesDelete` (Bug 3)
  - `handleNodesDelete` and `handleDeleteBlock` (Bug 4)
  - Wire `onEdgesDelete`, `onNodesDelete` on `<ReactFlow>`
  - Replace `onPaneClick` to converge with `handleSheetOpenChange`
  - Replace `<NodeConfigSheet onOpenChange>` with `handleSheetOpenChange`
  - Disable Save Automation button on `!validation.canStart` (Bug 5)
  - Provide `onDeleteBlock` in `AutomationEditorContextProvider` value
- `components/automations/automation-editor-context.tsx` — add `onDeleteBlock` to context value type.
- `components/automations/node-config-sheet.tsx` — header layout change + Delete button for non-trigger nodes, consume `useAutomationEditor()`.
- `lib/automations/graph.ts` — set `deletable: node.type !== 'trigger'` on each compiled node.
- `lib/automations/types.ts` — add `deletable?: boolean` to `AutomationFlowNode`.

### Test files modified

- `components/__tests__/automation-editor.test.tsx`:
  - Existing tests that click "+" → pick item should still pass (Dialog renders the same `NodePicker`).
  - Extend the React Flow mock to capture and expose `onNodesDelete` and `onEdgesDelete` on `latestReactFlowProps`.
  - New: clicking same node after closing the sheet reopens the sheet.
  - New: `onNodesDelete` cascades — pass an action node, assert it is removed and `configDirty` is true.
  - New: `onEdgesDelete` removes the edge from config.
  - New: trigger node has `deletable: false` in the props passed to `<ReactFlow>`.
  - New: Save Automation button is disabled when validation fails (use a config with an empty `forward_email.to`).
  - New: drawer Delete button invokes `onDeleteBlock` and removes the node from config.
- `lib/automations/__tests__/graph.test.ts`:
  - Assert compiled trigger node has `deletable: false`, condition and action have `deletable: true`.

### Files NOT modified

- `lib/automations/validation.ts` — existing rules already cover Bug 5.
- `lib/automations/schemas.ts` — no schema changes.
- `lib/automations/editor-state.ts` — `deleteNodeCascade` is already correct.
- API routes, dispatcher, executor, action handlers.
- `components/automations/palette-sidebar.tsx`, `components/automations/node-picker.tsx` — content of the picker is unchanged; only its wrapper changes inside the node components.
- `components/automations/nodes/action-node.tsx` — action nodes never had a "+" or trash; no change.

## Data flow

### Picker (Bug 1)

```text
User hovers trigger / condition node
  → "+" affordance reveals
User clicks "+"
  → DialogTrigger fires → setPickerOpen(true)
  → Dialog mounts with backdrop, focus trapped
User clicks "Forward Email"
  → NodePicker onPick('forward_email')
  → onPickBlock(id, 'forward_email') → addChildNode + reconcile + setSelectedNodeId(newId)
  → setPickerOpen(false) → Dialog unmounts
  → NodeConfigSheet auto-opens for the new node
```

### Sheet re-open (Bug 2)

```text
First click on node A
  → React Flow: A.selected = true, fires onNodeClick(A)
  → setSelectedNodeId('A') → sheet opens
User clicks X on sheet (or anywhere on the canvas pane)
  → handleSheetOpenChange(false):
      setSelectedNodeId(null)
      setNodes(map all → selected: false)
  → sheet closes; React Flow selection cleared
Second click on node A
  → React Flow: A.selected was false, now true, fires onNodeClick(A)
  → setSelectedNodeId('A') → sheet opens ✓
```

### Edge delete (Bug 3)

```text
User clicks an edge → React Flow internal selected = true
User presses Delete
  → React Flow fires onEdgesDelete([edge])
  → handleEdgesDelete: filter config.edges, reconcile
  → edge removed
```

### Node delete (Bug 4)

```text
Keyboard:
User selects a non-trigger node, presses Delete
  → React Flow: deletable=true → fires onNodesDelete([node])
  → handleNodesDelete: deleteNodeCascade(config, node.id) for each → reconcile
  → node + its edges + unreachable downstream removed

Trigger:
User selects trigger, presses Delete
  → React Flow: deletable=false → no callback fired
  → nothing happens

Drawer:
User opens drawer for a non-trigger node, clicks Delete
  → onDeleteBlock(nodeId) from context
  → handleDeleteBlock: deleteNodeCascade + reconcile + setSelectedNodeId(null)
  → drawer closes (open = Boolean(selectedNode) = false)
  → node removed
```

### Save gate (Bug 5)

```text
Editor renders
  → validation = validateAutomationGraph(config)
  → Save Automation button: disabled = isSaving || !dirty || !validation.canStart
  → Validation panel: lists every issue (existing UI)
User clicks Save Automation
  → only fires when canStart is true (button enabled)
  → API call proceeds; backend Zod is a backstop, not the user-facing surface
```

## Error handling

- **Delete an edge by mistake:** validation panel lights up if it leaves disconnected nodes or removes the last action path; user can redraw the edge or delete the orphaned node.
- **Delete the last action:** `no_reachable_action` issue blocks save, no destructive surprise.
- **Picker Dialog dismissed via Escape or backdrop click:** standard Dialog behavior, no state change.
- **`deleteNodeCascade` no-op:** when called with the trigger id (UI prevents this), returns the same config reference; the editor's identity check short-circuits before re-rendering.
- **`onNodesDelete` on multiple nodes at once:** the loop calls cascade per node; each call is idempotent and operates on the latest intermediate config.
- **`useAutomationEditor` inside `NodeConfigSheet`:** the editor wraps the entire returned JSX in `AutomationEditorContextProvider`, so the hook is always inside the provider when the sheet renders.

## Testing

### Updated test mock (Bug 3 + Bug 4)

Extend the `@xyflow/react` mock in `automation-editor.test.tsx` to surface `onNodesDelete` and `onEdgesDelete` via `latestReactFlowProps`, mirroring the existing `onConnect` exposure. Tests then invoke them with synthetic node/edge objects.

### New test cases

```ts
it('reopens the config sheet after closing and re-clicking the same node', async () => {...})
it('marks the trigger node as deletable=false in compiled flow nodes', () => {...})
it('removes a node and its edges via onNodesDelete', () => {...})
it('removes an edge via onEdgesDelete', () => {...})
it('disables Save Automation when validation fails', () => {...})
it('removes a node via the drawer Delete button', () => {...})
```

The existing 8 tests in `automation-editor.test.tsx` should remain green after the Popover → Dialog swap; the picker buttons still match by accessible name and the `data-testid="add-block-<id>"` selector is unchanged.

### `graph.test.ts` addition

```ts
it('marks trigger nodes as not deletable and others as deletable', () => {
  const config = createDefaultAutomationConfig()
  const layout = createDefaultAutomationLayout(config)
  const graph = compileAutomationGraph(config, layout)

  const trigger = graph.nodes.find((n) => n.id === 'trigger_email_received')
  const condition = graph.nodes.find((n) => n.id === 'condition_subject')
  const action = graph.nodes.find((n) => n.id === 'action_webhook')

  expect(trigger?.deletable).toBe(false)
  expect(condition?.deletable).toBe(true)
  expect(action?.deletable).toBe(true)
})
```

## Acceptance criteria

- Clicking the hover-revealed "+" on a trigger or condition opens a centered modal with backdrop and the 5-item Logic / Actions picker. The modal does not flicker open and closed. Pressing Escape or clicking the backdrop dismisses without picking.
- Picking an item creates the child node, dismisses the modal, and auto-opens the node config sheet for the new node.
- After closing the node config sheet via its X button, clicking the same node again reopens the sheet for that node.
- Selecting an edge and pressing Delete removes it from the canonical config and re-renders the graph.
- Selecting a non-trigger node and pressing Delete removes it, removes its connected edges, and prunes any downstream nodes that are no longer reachable from the trigger.
- Pressing Delete on the trigger does nothing.
- Opening the config drawer for a non-trigger node shows a Delete button in the header. Clicking it deletes the node (cascade) and closes the drawer. Trigger nodes show no Delete button.
- The Save Automation button is disabled whenever `validation.canStart === false`. The validation panel above the canvas continues to enumerate every issue. The button's `title` explains the disabled state.
- The Save Automation button remains enabled (when dirty) for a valid graph.
- All existing tests continue to pass; six new test cases pass; one new `graph.test.ts` case passes.
