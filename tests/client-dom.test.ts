/**
 * @vitest-environment jsdom
 *
 * DOM-level probe for the rewind button path (SiriLee/dsh-rewind#7). The
 * chat-channel fix reroutes the chat snapshot through `chatSnapshotOf`; these
 * cases pin the DOM→targets pairing (`collectTargets`) that turns a session's
 * chat nodes × action rows into the per-message ↶ portal targets — the one
 * piece the pure-function suites (`chat-channel`, `hidden`) do not reach.
 *
 * On the target line `actionsContainerOf` locates the actions container
 * structurally (the copy `<button>`'s own container), so the row shapes below
 * carry no `data-time-hover-root` marker.
 *
 * Compilation: typechecked by `tsconfig.client-test.json` (client surface +
 * JSX), excluded from `tsconfig.json` (host, no JSX) — see the neighbouring
 * `client-contract.test.ts` comment.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatConversationViewNode, HiddenChat } from '../src/client/hidden.ts'
import {
  actionsContainerOf, bubbleTextOf, collectDurableTargets, collectTargets, isRewindInertSession,
} from '../src/client/portals.tsx'

/** A durable user node in the HiddenChat shape the collector reads. */
function userNode(seq: number) {
  return {
    kind: 'user',
    anchorSeq: seq,
    data: { seq, time: seq * 1000, content: [{ type: 'text', text: `msg ${seq}` }] },
  }
}

/** Build a HiddenChat snapshot whose nodes are served by a Map. */
function chatWith(entries: Array<[string, unknown]>): HiddenChat {
  const nodes = new Map<string, unknown>(entries)
  return {
    order: [...nodes.keys()],
    nodes: { get: (key) => nodes.get(key) as ChatConversationViewNode | undefined },
  }
}

/** Append a user/steering row whose LAST child is the actions container holding
 * the copy `<button>` — the structural shape the collector accepts. */
function addRow(kind: string, key: string, opts: { withButton?: boolean } = {}): HTMLElement {
  const { withButton = true } = opts
  const row = document.createElement('div')
  row.dataset.chatFlowKind = kind
  row.dataset.chatAnchorKey = key
  const bubble = document.createElement('div')
  bubble.textContent = 'bubble'
  const actions = document.createElement('div')
  actions.className = 'actions'
  if (withButton) {
    const button = document.createElement('button')
    button.textContent = 'Copy'
    actions.appendChild(button)
  }
  row.append(bubble, actions)
  document.body.appendChild(row)
  return actions
}

/** Append a pending steering row: the row itself carries `[data-pending-steering]`
 * and its LAST child is the actions container holding the copy `<button>`. */
function addPendingRow(key: string, withButton = true): HTMLElement {
  const row = document.createElement('div')
  row.dataset.pendingSteering = ''
  const bubble = document.createElement('div')
  bubble.textContent = 'bubble'
  const actions = document.createElement('div')
  actions.className = 'actions'
  if (withButton) {
    const button = document.createElement('button')
    button.textContent = 'Copy'
    actions.appendChild(button)
  }
  row.append(bubble, actions)
  document.body.appendChild(row)
  return actions
}

/** IMAGE seat shape: the media gallery mounts the thumbnail as a `<button>`
 * (MessageImage's `.frame`, ui-attachment) and sits in `.userStack` BEFORE
 * `.actions` in document order. The old "first <button> in the row" heuristic
 * portaled the ↶ button into the gallery; the actions container must still be
 * located by the LAST button-bearing element. */
function addRowImage(kind: string, key: string, opts: { ownButtonInActions?: boolean } = {}): HTMLElement {
  const { ownButtonInActions = false } = opts
  const row = document.createElement('div')
  row.dataset.chatFlowKind = kind
  row.dataset.chatAnchorKey = key
  const userRow = document.createElement('div')
  const userStack = document.createElement('div')
  const gallery = document.createElement('div')
  const frame = document.createElement('button')
  frame.textContent = 'image'
  gallery.appendChild(frame)
  const bubble = document.createElement('div')
  bubble.textContent = 'bubble'
  userStack.append(gallery, bubble)
  const actions = document.createElement('div')
  actions.className = 'actions'
  const copy = document.createElement('button')
  copy.textContent = 'Copy'
  actions.appendChild(copy)
  if (ownButtonInActions) {
    const own = document.createElement('button')
    own.className = 'dsh-rewind-btn'
    actions.appendChild(own)
  }
  userRow.append(userStack, actions)
  row.appendChild(userRow)
  document.body.appendChild(row)
  return actions
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('collectTargets (chat node × user action row → portal target)', () => {
  it('collects a durable target for a matched user row', () => {
    const actions = addRow('user', 'm1')
    const targets = collectTargets(chatWith([['m1', userNode(5)]]))
    expect(targets).toHaveLength(1)
    expect(targets[0]).toEqual({
      kind: 'durable',
      key: 'm1',
      container: actions,
      seq: 5,
      time: 5000,
      preview: 'msg 5',
    })
  })

  it('collects steering rows the same way', () => {
    const actions = addRow('steering', 'm2')
    const targets = collectTargets(
      chatWith([['m2', { kind: 'steering', anchorSeq: 9, data: { seq: 9, time: 9000, content: [{ type: 'text', text: 'st' }] } }]]),
    )
    expect(targets).toHaveLength(1)
    const target = targets[0]!
    expect(target.kind).toBe('durable')
    if (target.kind === 'durable') {
      expect(target.seq).toBe(9)
      expect(target.container).toBe(actions)
    }
  })

  it('refuses a row whose actions container has no <button> (layout mismatch)', () => {
    addRow('user', 'm3', { withButton: false })
    const targets = collectTargets(chatWith([['m3', userNode(6)]]))
    expect(targets).toHaveLength(0)
  })

  it('skips a node absent from the visible order', () => {
    addRow('user', 'm4')
    const chat = chatWith([['m4', userNode(7)]])
    expect(collectTargets({ ...chat, order: [] })).toHaveLength(0)
  })

  it('collects nothing when a chat node has no matching DOM row', () => {
    const targets = collectTargets(chatWith([['m5', userNode(8)]]))
    expect(targets).toHaveLength(0)
  })
})

describe('collectDurableTargets (subagent sessions are rewind-inert)', () => {
  it('classifies the session kind from the snapshot subagent cell', () => {
    expect(isRewindInertSession({ subagent: null })).toBe(false)
    expect(isRewindInertSession({ subagent: { address: { mode: 'continuable' } } })).toBe(true)
  })

  it('collects the plain-session targets', () => {
    addRow('user', 's1')
    const targets = collectDurableTargets({ subagent: null }, chatWith([['s1', userNode(11)]]))
    expect(targets).toHaveLength(1)
  })

  it('collects nothing for a subagent session, same DOM and chat as the positive case', () => {
    addRow('user', 's2')
    const chat = chatWith([['s2', userNode(12)]])
    // Discriminating: identical chat snapshot and identical rendered row; only
    // the session kind differs, and the subagent one must yield no button.
    expect(collectDurableTargets({ subagent: { address: { mode: 'continuable' } } }, chat)).toHaveLength(0)
    expect(collectDurableTargets({ subagent: null }, chat)).toHaveLength(1)
  })

  it('collects nothing while the chat view is unavailable', () => {
    addRow('user', 's3')
    expect(collectDurableTargets({ subagent: null }, undefined)).toHaveLength(0)
  })
})

describe('actionsContainerOf (structural finder)', () => {
  it('finds the actions container on a plain user row', () => {
    const actions = addRow('user', 'a1')
    expect(actionsContainerOf(document.querySelector('[data-chat-anchor-key="a1"]')!)).toBe(actions)
  })

  it('finds the actions container on a pending steering row', () => {
    const actions = addPendingRow('p1')
    const pendingRow = document.querySelector('[data-pending-steering]')!
    expect(pendingRow).toBeInstanceOf(HTMLElement)
    expect(actionsContainerOf(pendingRow as HTMLElement)).toBe(actions)
  })

  it('locates the actions container, NOT the media gallery, on an image row', () => {
    // The thumbnail `<button>` in `.gallery` precedes `.actions`; the finder
    // must skip it and land on the copy button's container (dsh-rewind#7 image
    // regression: the ↶ button was pinned at the image's top-right).
    const actions = addRowImage('user', 'img1')
    expect(actionsContainerOf(document.querySelector('[data-chat-anchor-key="img1"]')!)).toBe(actions)
  })

  it('still locates the actions container when this plugin own button is already portaled there', () => {
    const actions = addRowImage('user', 'img2', { ownButtonInActions: true })
    expect(actionsContainerOf(document.querySelector('[data-chat-anchor-key="img2"]')!)).toBe(actions)
  })

  it('returns undefined when the row exposes no qualifying container', () => {
    const row = document.createElement('div')
    document.body.appendChild(row)
    expect(actionsContainerOf(row)).toBeUndefined()
  })
})

describe('bubbleTextOf (pending row compared text)', () => {
  /**
   * Append a pending steering row in the harness's real shape: the attachment
   * block FIRST (it renders before the message bubble), the bubble, then the
   * actions container holding the copy button. The attachment block's own text
   * stands in for a file card or an image's loading label.
   */
  function addPendingRowWithAttachment(bubble: string, attachment: string): HTMLElement {
    const row = document.createElement('div')
    row.dataset.pendingSteering = ''
    const attachments = document.createElement('div')
    attachments.dataset.messageAttachments = ''
    attachments.textContent = attachment
    const message = document.createElement('div')
    message.textContent = bubble
    const actions = document.createElement('div')
    actions.dataset.clock = 'start'
    const button = document.createElement('button')
    button.textContent = 'Copy'
    actions.appendChild(button)
    row.append(attachments, message, actions)
    document.body.appendChild(row)
    return row
  }

  it('excludes the attachment block and the actions container from the text', () => {
    const row = addPendingRowWithAttachment('look at this', 'LICENSE 1.0 KB')
    expect(bubbleTextOf(row)).toEqual({ text: 'look at this', attachments: 1 })
  })

  it('keeps the message text of an attachment-only row empty but counted', () => {
    // A lone image renders its loading label until the bytes resolve; that
    // label is the attachment block's text, never the message's.
    const row = addPendingRowWithAttachment('', 'loading…')
    expect(bubbleTextOf(row)).toEqual({ text: '', attachments: 1 })
  })
})
