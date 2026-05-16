# Interactive Automation Graph Design

## Goal

Upgrade the automation editor from a prewired three-node canvas into an interactive graph editor that lets users:

- add `condition` and `action` nodes from a palette
- drag nodes freely on the canvas
- draw valid connections between nodes
- run multiple downstream actions from the same trigger or condition
- start an automation only when the graph is valid and at least one action is reachable from the trigger

This design keeps the existing config-driven backend model. React Flow remains the editor and renderer, not the persistence contract.

## Product Decisions

- Each automation has exactly one trigger node.
- The trigger node is fixed and cannot be deleted.
- Users can add `condition` and `action` nodes only.
- Node creation uses palette-based creation from a selected source node.
- Disconnected nodes are not allowed.
- Conditions are gate nodes, not branch routers.
- Negative logic is expressed in the condition UI, for example `subject does not contain "invoice"`.
- If a condition evaluates `true`, execution continues to all connected downstream nodes.
- If a condition evaluates `false`, that path stops.
- Multiple downstream actions are allowed and all should run.

## Recommended Architecture

The editor stays config-first.

- Canonical automation state remains the versioned automation config plus layout.
- React Flow nodes and edges are derived editor state.
- User actions mutate canonical config and layout immediately.
- The editor recompiles config into React Flow nodes and edges after each mutation.

This is preferred over a canvas-first model because the existing repo already persists, validates, and executes from config, not from arbitrary React Flow state.

## Graph Model

### Node Types

- `trigger`
- `condition`
- `action`

### Handles

- Trigger: source handle only
- Condition: target handle plus one source handle
- Action: target handle only

This replaces the current `matched` / `unmatched` condition branching model.

### Allowed Connections

- `trigger -> condition`
- `trigger -> action`
- `condition -> condition`
- `condition -> action`
- `action -> none`

### Forbidden Connections

- incoming edges to `trigger`
- outgoing edges from `action`
- self-loops
- duplicate identical edges
- any node pair outside the allowed type rules

### Multiple Connections

- The trigger may connect to multiple downstream nodes.
- A condition may connect to multiple downstream nodes.
- When traversal reaches a valid source node, all connected downstream edges are followed.

## Editor Interaction Model

### Node Creation

Use palette-based creation from the currently selected source node.

- If `trigger` is selected, enable `Add Condition` and `Add Action`.
- If `condition` is selected, enable `Add Condition` and `Add Action`.
- If `action` is selected, disable add actions.
- If no valid source is selected, disable add actions and show a short hint.

When the user clicks a palette action:

1. create the new node with default config
2. place it near the selected source node
3. create the connecting edge immediately
4. select the new node and open its config sheet

This guarantees no disconnected nodes can be created.

### Node Movement

- Users may drag nodes freely after creation.
- Position changes update layout only.
- Layout remains separate from canonical graph semantics.

### Edge Creation

Users may draw additional valid edges between existing nodes.

React Flow integration should use:

- `onConnect`
- `onEdgesChange`
- top-level `isValidConnection`
- `addEdge`

Connection validity should be enforced live during edge drawing.

### Deletion

- The trigger cannot be deleted.
- Condition and action nodes may be deleted.
- Deleting a node also removes any downstream nodes that become disconnected from the trigger.

This keeps the graph invariant simple: no disconnected nodes may remain in the graph.

## Validation Model

Validation exists at two levels.

### Graph-Shape Validation

The graph is structurally valid only if:

- every non-trigger node has at least one incoming edge
- the trigger has no incoming edges
- action nodes have no outgoing edges
- all edges satisfy allowed type-pair rules
- no disconnected condition or action nodes exist
- no duplicate identical edges exist

### Start-Readiness Validation

An automation may be saved as a draft while incomplete, but it may only be started if:

- at least one action is reachable from the trigger
- every remaining node in the graph lies on some path reachable from the trigger
- no invalid structural graph errors remain

The key explicit product rule is:

- an automation cannot be started unless the trigger connects to at least one action, either directly or through one or more conditions

### Validation UX

The editor should show inline validation messages, not only toast errors.

Examples:

- `No action is reachable from the trigger`
- `Action node "Forward Email" is disconnected`
- `Action nodes cannot connect to other nodes`

`Start` is disabled while start-readiness validation fails.

## Condition Semantics

Conditions are boolean gates.

- `true` means continue to all connected downstream edges
- `false` means stop that path

The condition builder must support negative operators so users can model false-like logic without needing a separate `unmatched` branch.

Examples:

- `subject does not contain`
- `from is not`
- `body does not contain`

## Execution Semantics

The runtime must move from the current single-path traversal to queue-based or stack-based graph traversal.

Behavior:

1. start from the single trigger node
2. enqueue all connected downstream nodes
3. when a condition node is reached:
   - evaluate once for that path
   - if `true`, enqueue all connected downstream nodes
   - if `false`, stop that path
4. when an action node is reached:
   - execute the action
   - do not continue further, because actions have no outgoing edges

This is required to support multiple downstream actions and condition fan-out.

## File-Level Implementation Shape

### Frontend

- `components/automations/automation-editor.tsx`
  - enable connectability
  - add palette-based node creation
  - add edge creation and deletion handling
  - add inline validation display
- `components/automations/nodes/trigger-node.tsx`
  - source handle only
- `components/automations/nodes/condition-node.tsx`
  - single source handle plus target handle
- `components/automations/nodes/action-node.tsx`
  - target handle only
- `components/automations/node-config-sheet.tsx`
  - keep selection-driven editing
- `components/automations/condition-builder.tsx`
  - add negative operators
- `components/automations/editor-state.ts`
  - add helpers for create/connect/delete/validate operations

### Shared Graph / Validation

- `lib/automations/types.ts`
  - simplify condition-edge semantics away from `matched/unmatched`
- `lib/automations/graph.ts`
  - compile the updated one-source-handle model
- `lib/automations/schemas.ts`
  - enforce structural graph rules
- `lib/automations/definitions.ts`
  - update the default config shape to the new single-source-handle condition model

### Runtime

- `lib/automations/executor.ts`
  - replace single-next-edge traversal with multi-edge traversal

## React Flow Patterns to Reuse

Official React Flow APIs and examples most relevant to this design:

- drag-and-drop node creation via `onDrop`, `onDragOver`, `screenToFlowPosition`
- edge creation via `onConnect` and `addEdge`
- connection validation via top-level `isValidConnection`
- live connection restrictions through node handle directionality

These patterns come from the official React Flow documentation and examples reviewed during design research.

## Out of Scope

- multiple trigger nodes per automation
- plugin-style arbitrary node definitions
- free-floating disconnected draft nodes
- condition `matched` / `unmatched` branch routing
- action-to-action chaining

## Risks and Tradeoffs

- Cascading deletion is simple and preserves invariants, but it may surprise users if not clearly communicated.
- Moving from single-path execution to fan-out traversal is a real backend behavior change and must be tested carefully.
- Keeping config as source of truth reduces drift risk, but it means editor helpers must stay disciplined and schema-aware.

## Recommendation

Implement the editor as a config-first interactive graph with:

- one fixed trigger
- palette-based connected node creation
- live connection validation
- no disconnected nodes
- boolean gate conditions with negative operators
- queue-based runtime traversal that executes all reachable actions
