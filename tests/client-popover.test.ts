/**
 * @vitest-environment jsdom
 *
 * Modes-step probes for `openPopover` (SiriLee/dsh-rewind#26). The background
 * impact probe resolves the "rewind conversation and code" entry: it must
 * ALWAYS settle the step. A rejected admission (`ok:false`, e.g. a
 * subagent-owned identity) or an unmatched command line has to surface the
 * reason — never leave the step showing "checking file changes…" forever with
 * a permanently disabled entry, which is the invisible failure the issue
 * reported.
 *
 * Compilation: typechecked by `tsconfig.client-test.json` (client surface +
 * JSX), excluded from `tsconfig.json` (host, no JSX) — see the neighbouring
 * `client-dom.test.ts` comment.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HiddenChat } from '../src/client/hidden.ts'
import { closePopover, openPopover, registerComposerFocuser, type PopoverOptions } from '../src/client/popover.ts'
import { CLASS } from '../src/client/styles.ts'

/** A session face whose `command` resolves to `result` (or never, for `null`). */
function fakeSession(result: unknown): SessionFace {
  return {
    sessionId: 's1',
    command: vi.fn(() => (result === 'pending' ? new Promise(() => {}) : Promise.resolve(result))),
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => ({ subagent: null })),
  } as unknown as SessionFace
}

/** Translator stub: embeds params so the host-supplied reason stays readable. */
const t = ((key: string, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${String(params['path'] ?? params['message'])}`) as unknown as PopoverOptions['t']

/** Open the durable popover against `session` (no DOM rows needed). */
function open(session: SessionFace, chatOf: () => HiddenChat | undefined = () => undefined): void {
  openPopover({
    session,
    seq: 5,
    time: 0,
    preview: 'hello',
    chatOf,
    watchChat: () => () => {},
    anchor: document.body,
    t,
    onRewind: () => {},
  })
}

/** A chat snapshot holding this popover's settled preview command. */
function previewChat(text: string): HiddenChat {
  return {
    order: ['preview'],
    nodes: new Map([['preview', {
      key: 'preview',
      kind: 'command',
      anchorSeq: 6,
      data: {
        kind: 'command',
        seq: 6,
        time: 0,
        commandId: 'cid',
        name: 'rewind-plugin',
        args: 'preview @5 both',
        outcome: { kind: 'success', text },
      },
    }]]),
  }
}

/** Flush the microtask chain of the background impact probe. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/** The rendered option hints (mode entries) of the current popover step. */
function optionHints(): (string | null | undefined)[] {
  return [...document.querySelectorAll(`.${CLASS.popoverOptionHint}`)].map(node => node.textContent)
}

afterEach(() => {
  closePopover()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('openPopover (a failed impact probe settles the modes step)', () => {
  it('shows the host reason when the host rejects the preview command (ok:false)', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined)
    const session = fakeSession({
      ok: false,
      error: { code: 'session/agent-busy', message: 'owned by subagent routing', details: {} },
    })
    open(session)
    await settle()
    expect(document.querySelector(`.${CLASS.popoverImpact}`)?.textContent)
      .toContain('session/agent-busy: owned by subagent routing')
    // The step resolved: the code-restore entry is hidden, not left "checking…".
    expect(optionHints()).not.toContain('popover.checking')
    expect(warn).toHaveBeenCalled()
  })

  it('shows a reason when the command line is not matched by the host', async () => {
    const warn = vi.spyOn(console, 'warn').mockReturnValue(undefined)
    open(fakeSession({ ok: true, value: { matched: false } }))
    await settle()
    expect(document.querySelector(`.${CLASS.popoverImpact}`)?.textContent)
      .toContain('the rewind command is not registered on this host')
    expect(optionHints()).not.toContain('popover.checking')
    expect(warn).toHaveBeenCalled()
  })

  it('keeps the pending entry disabled while the probe is still in flight', () => {
    open(fakeSession('pending'))
    expect(optionHints()).toContain('popover.checking')
  })
})

describe('openPopover (the impact step reports checkpointing-off)', () => {
  /** Open, settle a successful preview, then enter the both-mode impact step. */
  async function impactText(previewText: string): Promise<string> {
    let chat: HiddenChat | undefined
    open(fakeSession({ ok: true, value: { matched: true } }), () => chat)
    chat = previewChat(previewText)
    await settle()
    const both = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('popover.both'))
    both?.click()
    await settle()
    return document.querySelector(`.${CLASS.popoverImpact}`)?.textContent ?? ''
  }

  it('appends the note when the host reports backup=off', async () => {
    const impact = await impactText('Rewind to seq 5.\nimpact=1\nrestore:/a\nbackup=off')
    expect(impact).toContain('popover.impact.restore:/a')
    expect(impact).toContain('popover.backupDisabled')
  })

  it('omits the note when the host does not report it', async () => {
    const impact = await impactText('Rewind to seq 5.\nimpact=1\nrestore:/a')
    expect(impact).toContain('popover.impact.restore:/a')
    expect(impact).not.toContain('popover.backupDisabled')
  })
})

describe('closePopover (the unload teardown)', () => {
  /** Let the popover's deferred (0ms) listener attachment actually run. */
  const nextTick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0) })

  /** Whether a document-level ArrowDown is still intercepted by the popover. */
  function stealsArrowDown(): boolean {
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    document.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('removes the DOM and stops stealing keys', async () => {
    open(fakeSession({ ok: true, value: { matched: true } }))
    await settle()
    await nextTick()
    // Open: the capture-phase handler owns ↑/↓/Esc away from the composer.
    expect(document.querySelector(`.${CLASS.popover}`)).not.toBeNull()
    expect(stealsArrowDown()).toBe(true)

    // The plugin's fiber disposer calls exactly this on unload.
    closePopover()
    expect(document.querySelector(`.${CLASS.popover}`)).toBeNull()
    expect(stealsArrowDown()).toBe(false)
  })

  it('hands the keyboard back to the composer it took it from', async () => {
    const focus = vi.fn()
    registerComposerFocuser(focus)
    open(fakeSession({ ok: true, value: { matched: true } }))
    await settle()
    await nextTick()
    expect(focus).not.toHaveBeenCalled()
    closePopover()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(focus).toHaveBeenCalledWith('s1')
  })

  it('is safe with nothing open and does not throw on a repeat call', () => {
    closePopover()
    closePopover()
    expect(stealsArrowDown()).toBe(false)
  })
})
