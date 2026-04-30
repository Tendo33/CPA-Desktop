import { create } from 'zustand'

type ToastTone = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  tone: ToastTone
  message: string
  durationMs: number
}

interface ToastStore {
  items: ToastItem[]
  push: (tone: ToastTone, message: string, durationMs?: number) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastStore>((set, get) => ({
  items: [],
  push: (tone, message, durationMs = 3500) => {
    const id = nextId++
    set((s) => ({ items: [...s.items, { id, tone, message, durationMs }] }))
    setTimeout(() => get().dismiss(id), durationMs)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

export const toast = {
  info: (m: string) => useToastStore.getState().push('info', m),
  success: (m: string) => useToastStore.getState().push('success', m),
  error: (m: string) => useToastStore.getState().push('error', m),
}
