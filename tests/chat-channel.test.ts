/**
 * Chat-channel probes (SiriLee/dsh-rewind#7). On the target line the chat
 * snapshot lives on the `uiConversation` service's named "chat" view
 * (contributed by dsh-client-ui-chat). `chatSnapshotOf` reads that single
 * channel; these probes lock the Map-like snapshot shape and the undefined
 * degradation when no view is registered.
 */
import { describe, expect, it } from 'vitest'
import { chatSnapshotOf, type HiddenChat } from '../src/client/hidden.ts'

/** The 0.1.2 EMPTY_CHAT_SNAPSHOT shape (dsh-client-ui-chat): Map-like nodes. */
const EMPTY_CHAT_SNAPSHOT_012 = {
  order: [],
  nodes: { get: () => undefined, values: () => [] },
}

const viewOf = (snapshot: unknown) => ({ getSnapshot: () => snapshot })

describe('chatSnapshotOf (0.1.2 uiConversation "chat" view)', () => {
  it('reads the chat view snapshot when registered', () => {
    const chat: HiddenChat = { order: [], nodes: { get: () => undefined } }
    expect(chatSnapshotOf(viewOf(chat))).toBe(chat)
  })

  it('degrades to undefined for an unregistered view (getSnapshot() === undefined)', () => {
    expect(chatSnapshotOf(viewOf(undefined))).toBe(undefined)
  })

  it('degrades to undefined when there is no view at all', () => {
    expect(chatSnapshotOf(undefined)).toBe(undefined)
  })

  it('accepts the 0.1.2 EMPTY_CHAT_SNAPSHOT shape', () => {
    const snapshot = chatSnapshotOf(viewOf(EMPTY_CHAT_SNAPSHOT_012))
    expect(snapshot).toBeDefined()
    expect(snapshot!.order).toEqual([])
    expect(snapshot!.nodes.get('missing')).toBeUndefined()
  })
})
