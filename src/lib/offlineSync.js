import { supabase } from '../supabaseClient'

// Local-first offline support for posting_slots edits. When the device
// has no signal, changes are saved to localStorage instead of failing
// silently, then synced automatically once the connection is back.

const QUEUE_KEY = 'impi_offline_queue_v1'
const CACHE_PREFIX = 'impi_cache_v1_'

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  } catch {
    // storage full or unavailable — nothing more we can do locally
  }
}

// Queue a posting_slots update. Repeated edits to the same row before
// the next sync collapse into a single pending change.
export function queueSlotUpdate(id, patch) {
  const queue = readQueue()
  const existing = queue.find((q) => q.id === id)
  if (existing) {
    existing.patch = { ...existing.patch, ...patch }
    existing.queuedAt = Date.now()
  } else {
    queue.push({ id, patch, queuedAt: Date.now() })
  }
  writeQueue(queue)
}

export function getQueueCount() {
  return readQueue().length
}

let flushing = false

// Tries to push every queued change to Supabase. Anything that still
// fails (still offline) stays queued for the next attempt.
export async function flushQueue() {
  if (flushing) return getQueueCount()
  flushing = true
  try {
    const queue = readQueue()
    if (queue.length === 0) return 0
    const remaining = []
    for (const item of queue) {
      try {
        const { error } = await supabase
          .from('posting_slots')
          .update(item.patch)
          .eq('id', item.id)
        if (error) throw error
      } catch {
        remaining.push(item)
      }
    }
    writeQueue(remaining)
    return remaining.length
  } finally {
    flushing = false
  }
}

// Caches a full posting sheet load so the page can still render if
// opened while offline (e.g. tablet was closed overnight with no signal).
export function cachePostingSheet(eventId, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + eventId, JSON.stringify(data))
  } catch {
    // ignore
  }
}

export function getCachedPostingSheet(eventId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + eventId)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
