import { invoke } from '@tauri-apps/api/core'

export interface AppSettings {
  port: number
  autoStart: boolean
  cpaVersion: string | null
}

export interface UpdateCheckResult {
  currentVersion: string | null
  latestVersion: string
  updateAvailable: boolean
  downloadUrl: string
}

export interface LogLine {
  ts: string
  level: 'stdout' | 'stderr'
  text: string
}

export type CpaStatus =
  | 'Idle'
  | 'Starting'
  | 'Running'
  | 'Stopped'
  | { error: string }

// CPA process
export const startCpa = () => invoke<void>('start_cpa')
export const stopCpa = () => invoke<void>('stop_cpa')
export const getCpaStatus = () => invoke<CpaStatus>('get_cpa_status')
export const getCpaPort = () => invoke<number>('get_cpa_port')
export const checkCpaRunning = () => invoke<boolean>('check_cpa_running')
export const cpaBinaryExists = () => invoke<boolean>('cpa_binary_exists')

// Logs
export const getLogHistory = () => invoke<LogLine[]>('get_log_history')
export const clearLogs = () => invoke<void>('clear_logs')

// Config / settings
export const getSettings = () => invoke<AppSettings>('get_settings')
export const saveSettings = (settings: AppSettings) =>
  invoke<void>('save_settings_cmd', { settings })
export const readConfigYaml = () => invoke<string>('read_config_yaml')
export const writeConfigYaml = (content: string) =>
  invoke<void>('write_config_yaml', { content })
export const openDataDir = () => invoke<void>('open_data_dir')

// Updater
export const checkCpaUpdate = () => invoke<UpdateCheckResult>('check_cpa_update')
export const downloadCpaUpdate = (downloadUrl: string, version: string) =>
  invoke<void>('download_cpa_update', { downloadUrl, version })
