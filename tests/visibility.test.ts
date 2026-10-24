/**
 * Snapshot-level visibility probes: the wrapper must turn an executed rewind's
 * `[target, marker]` span into `visibility: 'hidden'` before the Chat builder
 * computes `order`, while keeping the nodes in the store for composer refill.
 */
import { describe, expect, it, vi } from 'vitest'
import type { CommandNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ENGINE_COMMAND, rewindCutsOf, type ChatConversationViewNode, type RewindCut } from '../src/client/hidden.ts'
import { installChatViewVisibility, RewindVisibilityBuilder } from '../src/client/visibility.ts'

type Node = ChatConversationViewNode

function turnLocation(turn: number, startSeq: number): unknown {
  return {
    kind: 'turn',
    turn: {
      turn,
      status: 'closed',
      steps: [],
      start: { seq: startSeq, time: 0, type: 'turn/start', data: { turn } },
      end: { seq: startSeq + 100, time: 0, type: 'turn/end', data: { turn, reason: { kind: 'completed' } } },
      data: {},
    },
  }
}

function node(
  key: string,
  kind: string,
  anchorSeq: number,
  data: unknown,
  turn?: number,
  startSeq?: number,
): Node {
  return {
    key,
    kind,
    id: key,
    target: 'chat',
    anchorSeq,
    location: turn === undefined ? { kind: 'session' } : turnLocation(turn, startSeq ?? 1),
    visibility: 'visible',
    data,
  } as unknown as Node
}

function user(key: string, anchorSeq: number, turn: number, startSeq: number): Node {
  return node(key, 'user', anchorSeq, {
    kind: 'user', seq: anchorSeq, time: 0,
    content: [{ type: 'text', text: key }], source: { kind: 'user' },
  }, turn, startSeq)
}

function assistant(key: string, anchorSeq: number, turn: number, startSeq: number): Node {
  return node(key, 'assistant-step', anchorSeq, {
    status: 'settled', turn, step: 1, blocks: [{ kind: 'text', text: key }], time: 0,
  }, turn, startSeq)
}

function turnProcess(key: string, anchorSeq: number, turn: number, startSeq: number): Node {
  return node(key, 'turn-process', anchorSeq, {
    turn, controlAnchorSeq: startSeq, processStartSeq: startSeq,
    answerAnchorSeq: null, answerStep: null, inlineReasoning: false,
    messageCount: 1, toolCallCount: 0, subagentCount: 0,
  }, turn, startSeq)
}

function command(key: string, anchorSeq: number, seq: number, target: number, marker: number): Node {
  return node(key, 'command', anchorSeq, {
    kind: 'command', seq, time: 0, commandId: key, name: ENGINE_COMMAND,
    args: `@${target} chat`, outcome: { kind: 'success', sourceEventSeq: marker },
  } as unknown as CommandNode)
}

class FakeBuilder {
  nodes = new Map<string, Node>()
  order: readonly string[] = []

  get empty(): unknown {
    return { order: [], nodes: new Map() }
  }

  replace(input: { readonly nodes: readonly Node[] }): unknown {
    this.nodes = new Map(input.nodes.map(value => [value.key, value]))
    return this.recompute()
  }

  apply(input: { readonly upserts: readonly Node[] }): unknown {
    for (const value of input.upserts) this.nodes.set(value.key, value)
    return this.recompute()
  }

  groupInput(): unknown {
    return { kind: 'replace', order: this.order, readNode: (key: string) => this.nodes.get(key) }
  }

  publish(): void {}

  protected recompute(): unknown {
    this.order = [...this.nodes.values()]
      .filter(value => value.visibility !== 'hidden')
      .sort((left, right) => left.anchorSeq - right.anchorSeq)
      .map(value => value.key)
    return { order: this.order, nodes: this.nodes }
  }
}

const timeline = { turnOrder: [1, 2], turns: new Map() }

const baseNodes = (): Node[] => [
  turnProcess('p1', 0.9, 1, 1),
  user('u1', 5, 1, 1),
  assistant('a1', 6, 1, 1),
  turnProcess('p2', 29.9, 2, 30),
  user('u2', 35, 2, 30),
  assistant('a2', 36, 2, 30),
]

describe('rewindCutsOf', () => {
  it('reads one cut per marker-carrying successful engine command', () => {
    expect(rewindCutsOf([command('cmd1', 40, 40, 5, 20), command('cmd2', 50, 50, 35, 45)]))
      .toEqual<RewindCut[]>([{ target: 5, marker: 20 }, { target: 35, marker: 45 }])
  })

  it('ignores failed, markerless, probe, and unparsable commands', () => {
    const failed = node('f', 'command', 1, {
      kind: 'command', seq: 1, time: 0, commandId: 'f', name: ENGINE_COMMAND,
      args: '@5 chat', outcome: { kind: 'error', text: 'no' },
    })
    const markerless = node('m', 'command', 2, {
      kind: 'command', seq: 2, time: 0, commandId: 'm', name: ENGINE_COMMAND,
      args: '@5 chat', outcome: { kind: 'success', text: 'hint' },
    })
    const probe = node('p', 'command', 3, {
      kind: 'command', seq: 3, time: 0, commandId: 'p', name: ENGINE_COMMAND,
      args: 'preview @5 both', outcome: { kind: 'success', sourceEventSeq: 3 },
    })
    expect(rewindCutsOf([failed, markerless, probe])).toEqual([])
  })
})

describe('RewindVisibilityBuilder', () => {
  it('hides the span, the command, and an emptied Turn-process summary', () => {
    const builder = new RewindVisibilityBuilder(new FakeBuilder())
    const snapshot = builder.replace({ nodes: [...baseNodes(), command('cmd1', 40, 40, 5, 20)], timeline }) as {
      order: readonly string[]
      nodes: Map<string, Node>
    }
    expect(snapshot.order).toEqual(['p2', 'u2', 'a2'])
    expect(snapshot.nodes.get('u1')?.visibility).toBe('hidden')
    expect(snapshot.nodes.get('p1')?.visibility).toBe('hidden')
    expect(snapshot.nodes.get('cmd1')?.visibility).toBe('hidden')
    // The data stays readable for composer refill.
    expect((snapshot.nodes.get('u1')?.data as { content: Array<{ text: string }> }).content[0]?.text).toBe('u1')
  })

  it('recomputes all nodes when a later cut appears through apply', () => {
    const builder = new RewindVisibilityBuilder(new FakeBuilder())
    builder.replace({ nodes: [...baseNodes(), command('cmd1', 40, 40, 5, 20)], timeline })
    const snapshot = builder.apply({
      upserts: [command('cmd2', 50, 50, 35, 45)],
      timeline,
    }) as { order: readonly string[]; nodes: Map<string, Node> }
    expect(snapshot.order).toEqual([])
    expect(snapshot.nodes.get('u1')?.visibility).toBe('hidden')
    expect(snapshot.nodes.get('u2')?.visibility).toBe('hidden')
  })

  it('hides a content-only upsert that lands inside an active cut', () => {
    const builder = new RewindVisibilityBuilder(new FakeBuilder())
    builder.replace({ nodes: [...baseNodes(), command('cmd1', 40, 40, 5, 20)], timeline })
    const snapshot = builder.apply({
      upserts: [assistant('a1b', 7, 1, 1)],
      timeline,
    }) as { order: readonly string[]; nodes: Map<string, Node> }
    expect(snapshot.order).toEqual(['p2', 'u2', 'a2'])
    expect(snapshot.nodes.get('a1b')?.visibility).toBe('hidden')
  })

  it('hides a node contained by either of two cuts', () => {
    const builder = new RewindVisibilityBuilder(new FakeBuilder())
    const nodes = [...baseNodes(), command('cmd1', 40, 40, 5, 40), command('cmd2', 50, 50, 20, 50)]
    nodes.push(user('u30', 30, 2, 30))
    const snapshot = builder.replace({ nodes, timeline }) as { order: readonly string[] }
    expect(snapshot.order).not.toContain('u30')
  })
})

describe('installChatViewVisibility', () => {
  it('patches the chat definition, rebuilds open sessions, and restores on dispose', () => {
    const definition = { target: 'chat', create: () => new FakeBuilder() }
    const unsubscribe = vi.fn()
    const rebuild = vi.fn()
    const ui = {
      views: {
        entries: () => [definition],
        subscribe: () => unsubscribe,
      },
      binding: () => ({ rebuild }),
    }
    const sessions = {
      list: {
        getSnapshot: () => ({
          ids: ['s1'],
          byId: { s1: { retainedBy: { mainView: 1 } } },
        }),
      },
    }
    let dispose: (() => void) | undefined
    const ctx = {
      get: (name: string) => name === 'uiConversation' ? ui : undefined,
      effect: (execute: () => (() => void) | void) => {
        const cleanup = execute()
        if (typeof cleanup === 'function') dispose = cleanup
        return cleanup
      },
      sessions,
    }
    installChatViewVisibility(ctx as never)
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(definition.create()).toBeInstanceOf(RewindVisibilityBuilder)

    dispose?.()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(definition.create()).toBeInstanceOf(FakeBuilder)
  })
})
