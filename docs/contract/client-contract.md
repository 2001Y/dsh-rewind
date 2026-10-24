# Client contract — withdrawn seqs

How another plugin learns **which Chat nodes a rewind withdrew**. This is the
only sanctioned answer; everything not listed here is internal and may change
without notice. The document follows the current plugin line — see the release
notes for version alignment.

## Stability tiers

| Channel | Stability | Consumers |
| --- | --- | --- |
| this plugin's engine command `args` `@<seq>` (`rewind-plugin`; `rewind` in older sessions) | ✅ stable, semver-protected | machine |
| `outcome.sourceEventSeq` (marker log seq) | ✅ stable, semver-protected | machine |
| `hiddenSeqsOf` / `targetSeqOfArgs` / `HiddenChat` from `dsh-rewind-plugin/client` | ✅ stable, semver-protected | machine |
| `outcome.text` | ❌ **not** stable — human copy, never parse | — |

## The sanctioned channel

`dsh-rewind-plugin/client` exports the pure, locale-independent computation the
plugin itself uses. It never reads the DOM or host copy.

```ts
import { hiddenSeqsOf, targetSeqOfArgs, type HiddenChat } from 'dsh-rewind-plugin/client'

const chat = uiConversation.binding(sessionId).target('chat')?.getSnapshot() // the `uiConversation` "chat" view
const hidden = hiddenSeqsOf(chat as HiddenChat) // Set<number> of withdrawn seqs
```

Pass the snapshot just read from the live view; do not retain it. `hiddenSeqsOf`
uses the store's `nodes.values()` when present (so nodes already hidden by the
visibility layer are still visible to the computation) and falls back to
`order` for older snapshots. The result is memoized per snapshot wrapper and
each call returns a fresh `Set`.

The set contains:

- every legacy internal probe row (`preview` / `__candidates`), in any state;
- every successful engine command row carrying a marker (`sourceEventSeq`);
- every node whose `anchorSeq` falls inside an executed rewind's
  `[target, marker]` span.

Each executed rewind cuts one span. Overlapping spans merge; adjacent spans stay
separate, so new traffic between an earlier marker and a later target remains
visible. A failed command, or a success without a marker, contributes neither a
command row nor a cut. Group shells and Turn-process summaries are presentation
constructs and are not part of this set; the visibility layer hides an emptied
summary directly.

`targetSeqOfArgs(args)` extracts the first `@<digits>` target from a command's
raw `args`. It is a parsing helper, not a validation API.

## Snapshot visibility

Withdrawn nodes are marked `visibility: 'hidden'` before the Chat builder
computes `order`. They leave `order`, grouping, Turn locations, and the loaded
Turn navigation, and their React rows are not mounted. The nodes remain in
`nodes.values()` for composer refill and for `hiddenSeqsOf`.

There is no DOM row hiding and no `data-dsh-rewind-hidden` attribute. Consumers
that relied on that attribute must migrate to `hiddenSeqsOf`.

The Turn rail is not part of the hide: it also merges the host `turnOutline`, so
a fully hidden Turn can still appear there as an unloaded mark. Do not treat the
rail as a visibility guarantee.

## Explicit non-contract

`outcome.text` is human-facing copy; parsing it is a bug. The following are also
not stable: DOM attributes (`data-chat-*` or any rewind marker), the Turn rail's
state, the registered builder's internal shape, and group/Turn-process anchors.

## Maintenance rules

- Any change to a listed tier updates this document in the same PR.
- Breaking a listed stability tier is a minor/major version bump.
- `scripts/build.mjs` asserts the public client export surface on every build.
