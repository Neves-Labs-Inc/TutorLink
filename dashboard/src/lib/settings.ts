export type Setting = {
  key: string
  value: string
  value_type: string
  is_developer_only: boolean
}

export type SettingUpdate = {
  key: string
  value: string
}

export type SettingControl = 'integer' | 'readonly'

export const settingLabel = (key: string): string =>
  key
    .split('_')
    .join(' ')
    .replace(/^./, (char) => char.toUpperCase())

export const settingControl = (valueType: string): SettingControl =>
  valueType === 'integer' ? 'integer' : 'readonly'

export const pendingUpdates = (
  settings: Setting[],
  draft: Record<string, string>,
): SettingUpdate[] => {
  const updates: SettingUpdate[] = []

  for (const setting of settings) {
    const draftValue = draft[setting.key]

    if (settingControl(setting.value_type) === 'integer' && draftValue !== undefined) {
      const trimmed = draftValue.trim()

      if (trimmed !== setting.value) {
        updates.push({ key: setting.key, value: trimmed })
      }
    }
  }

  return updates
}
