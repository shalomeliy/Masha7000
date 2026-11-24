import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { readJson, writeJson } from '../google/drive'
import { DRIVE_FILES } from '../google/config'
import { resolveFeatures, withFeature, type FeatureId } from '../features'
import type { AppSettings } from '../../types/models'

// The team's settings.json (calendar id, features, onboarding), read once and shared by every screen.
// Writes merge into the file as read now, so nothing else in it (calendarId) is lost.

export const SETTINGS_KEY = ['drive', 'settings'] as const

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await readJson<AppSettings>(DRIVE_FILES.settings)) ?? {},
    staleTime: 5 * 60_000,
    refetchOnMount: false,
  })
}

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: SETTINGS_KEY,
    scope: { id: 'drive-settings' },
    mutationFn: async (change: Partial<AppSettings>) => {
      const now = (await readJson<AppSettings>(DRIVE_FILES.settings)) ?? {}
      const next = { ...now, ...change }
      await writeJson(DRIVE_FILES.settings, next)
      return next
    },
    onMutate: (change) => {
      const previous = qc.getQueryData<AppSettings>(SETTINGS_KEY)
      qc.setQueryData<AppSettings>(SETTINGS_KEY, { ...previous, ...change })
      return { previous }
    },
    onSuccess: (next) => qc.setQueryData(SETTINGS_KEY, next),
    onError: (_e, _c, ctx) => qc.setQueryData(SETTINGS_KEY, ctx?.previous),
  })
}

/** Is a feature on for this team. While settings are still loading, everything counts as on (nothing flickers away). */
export function useFeatures() {
  const settings = useSettings()
  const save = useSaveSettings()
  const flags = resolveFeatures(settings.data)
  return {
    flags,
    isOn: (id: FeatureId) => flags[id],
    loaded: settings.isSuccess,
    settings: settings.data,
    setFeature: (id: FeatureId, on: boolean) => save.mutateAsync({ features: withFeature(flags, id, on), onboarding: settings.data?.onboarding ?? { version: 1, answers: {}, doneAt: new Date().toISOString() } }),
    saving: save.isPending,
  }
}

/** Same, for plain code (Shali's free commands): reads the shared cache, everything on when not loaded. */
export function featuresFromCache(qc: { getQueryData: (key: readonly unknown[]) => unknown }) {
  return resolveFeatures(qc.getQueryData(SETTINGS_KEY) as AppSettings | undefined)
}
