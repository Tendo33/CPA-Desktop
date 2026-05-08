import { create } from 'zustand'

interface AppSettingsState {
  autoCheckAppUpdates: boolean
  setAutoCheckAppUpdates: (enabled: boolean) => void
}

export const useAppSettingsStore = create<AppSettingsState>()((set) => ({
  autoCheckAppUpdates: false,
  setAutoCheckAppUpdates: (autoCheckAppUpdates) => set({ autoCheckAppUpdates }),
}))
