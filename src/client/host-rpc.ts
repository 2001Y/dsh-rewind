/**
 * The browser half of the rewind RPC channel: the mode popover's impact
 * preview and the `/rewind` candidate list. Both are read-only host queries,
 * so they travel over Connection RPC instead of the human command channel.
 *
 * @module dsh-rewind/client/host-rpc
 */

import type { RewindCandidate } from './candidates.ts'
import { rewindLog } from './log.ts'

const CHANNEL = '/dsh-rewind'
const TIMEOUT_MS = 8000

/** One file affected by a rewind. */
export interface PreviewFileImpact {
  readonly path: string
  readonly action: 'restore' | 'delete'
}

/** One impact probe resolved, failed, or timed out (`null`). */
export type PreviewOutcome =
  | { readonly kind: 'success'; readonly files: readonly PreviewFileImpact[]; readonly backupOff: boolean }
  | { readonly kind: 'error'; readonly text: string }
  | null

/** Fetch one target's impact through the registered RPC call. */
export type PreviewCall = (sessionId: string, seq: number) => Promise<PreviewOutcome>

type RpcResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The slice of the client `connection` service this module reads. */
export interface ConnectionLike {
  readonly rpc: {
    call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult>
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isImpact(value: unknown): value is PreviewFileImpact {
  return isRecord(value)
    && typeof value['path'] === 'string'
    && (value['action'] === 'restore' || value['action'] === 'delete')
}

function isCandidate(value: unknown): value is RewindCandidate {
  return isRecord(value)
    && Number.isSafeInteger(value['seq'])
    && typeof value['time'] === 'number' && Number.isFinite(value['time'])
    && typeof value['preview'] === 'string'
}

function isAbort(error: unknown): boolean {
  const name = (error as { readonly name?: unknown } | null)?.name
  return name === 'AbortError' || name === 'TimeoutError'
}

/** Resolve one target's file impact over RPC. */
export async function previewOverRpc(
  connection: ConnectionLike | undefined,
  sessionId: string,
  seq: number,
): Promise<PreviewOutcome> {
  if (connection === undefined) return { kind: 'error', text: 'host RPC is unavailable' }
  try {
    const result = await connection.rpc.call(CHANNEL, 'preview', { sessionId, seq }, AbortSignal.timeout(TIMEOUT_MS))
    if (!result.ok) {
      rewindLog.warn('preview', `RPC preview failed for @${seq}`, result.error)
      return { kind: 'error', text: result.error.message }
    }
    const value = result.value
    if (!isRecord(value) || typeof value['backupOff'] !== 'boolean'
      || !Array.isArray(value['files']) || !value['files'].every(isImpact)) {
      rewindLog.warn('preview', `RPC preview returned an invalid result for @${seq}`)
      return { kind: 'error', text: 'invalid preview response' }
    }
    return { kind: 'success', files: value['files'], backupOff: value['backupOff'] }
  } catch (error) {
    if (isAbort(error)) {
      rewindLog.warn('preview', `RPC preview timed out for @${seq}`)
      return null
    }
    rewindLog.warn('preview', `RPC preview threw for @${seq}`, error)
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/** Fetch the full rewind candidate list over RPC. */
export async function candidatesOverRpc(
  connection: ConnectionLike | undefined,
  sessionId: string,
): Promise<readonly RewindCandidate[] | undefined> {
  if (connection === undefined) return undefined
  try {
    const result = await connection.rpc.call(CHANNEL, 'candidates', { sessionId }, AbortSignal.timeout(TIMEOUT_MS))
    if (!result.ok) {
      rewindLog.warn('preview', 'RPC candidates failed', result.error)
      return undefined
    }
    const value = result.value
    if (!isRecord(value) || !Array.isArray(value['candidates']) || !value['candidates'].every(isCandidate)) {
      rewindLog.warn('preview', 'RPC candidates returned an invalid result')
      return undefined
    }
    return value['candidates']
  } catch (error) {
    rewindLog.warn('preview', 'RPC candidates threw', error)
    return undefined
  }
}
