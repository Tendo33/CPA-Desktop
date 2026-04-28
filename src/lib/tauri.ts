import { invoke } from '@tauri-apps/api/core'

export interface LastPanic {
  atIso: string
  message: string
}

export type InstallSource =
  | { kind: 'managed' }
  | { kind: 'homebrew'; prefix: string }
  | { kind: 'systemPath'; binary: string; config: string }
  | { kind: 'custom'; binary: string; config: string; workingDir: string }

export type UpdateStrategy = 'githubRelease' | 'brewUpgrade' | 'externalNotice'

export interface ResolvedPaths {
  binary: string
  config: string
  workingDir: string
}

export interface InstallSourceInfo {
  source: InstallSource
  paths: ResolvedPaths
  strategy: UpdateStrategy
  validationErrors: string[]
}

export interface DetectedInstall {
  source: InstallSource
  note: string | null
}

export interface DetectionReport {
  managedPresent: boolean
  homebrew: DetectedInstall | null
  systemPath: DetectedInstall | null
}

export interface ExternalUpdateInstructions {
  heading: string
  commands: string[]
  link: string | null
}

export interface BrewUpgradeResult {
  success: boolean
  log: string
}

export interface AppSettings {
  schemaVersion?: number
  port: number
  autoStart: boolean
  cpaVersion: string | null
  lastPanic?: LastPanic | null
  autoCheckAppUpdates?: boolean
  mirrors?: string[]
  installSource?: InstallSource
}

export interface UpdateCheckResult {
  currentVersion: string | null
  latestVersion: string
  updateAvailable: boolean
  downloadUrl: string
  strategy: UpdateStrategy
}

export interface LogLine {
  ts: string
  level: 'stdout' | 'stderr'
  text: string
}

export type { CpaStatus } from '@/types/cpa'
import type { CpaStatus } from '@/types/cpa'

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
export const writeConfigYaml = (content: string) => invoke<void>('write_config_yaml', { content })
export const writeConfigYamlPort = (port: number) =>
  invoke<void>('write_config_yaml_port', { port })
export const readConfigField = <T = unknown>(path: string) =>
  invoke<T | null>('read_config_field', { path })
export const writeConfigField = (path: string, value: unknown) =>
  invoke<void>('write_config_field', { path, value })
export const listConfigBackups = () => invoke<string[]>('list_config_backups')
export const restoreConfigBackup = (name: string) =>
  invoke<string>('restore_config_backup', { name })
export const openDataDir = () => invoke<void>('open_data_dir')
export const getPortFromYaml = () => invoke<number>('get_port_from_yaml')
export const getAutolaunchEnabled = () => invoke<boolean>('get_autolaunch_enabled')
export const setAutolaunchEnabled = (enabled: boolean) =>
  invoke<void>('set_autolaunch_enabled', { enabled })

// Updater
export const checkCpaUpdate = () => invoke<UpdateCheckResult>('check_cpa_update')
export const downloadCpaUpdate = (downloadUrl: string, version: string, mirrors?: string[]) =>
  invoke<void>('download_cpa_update', { downloadUrl, version, mirrors })

// Install source
export const getInstallSourceInfo = () => invoke<InstallSourceInfo>('get_install_source_info')
export const detectInstallSources = () => invoke<DetectionReport>('detect_install_sources')
export const validateInstallSource = (source: InstallSource) =>
  invoke<string[]>('validate_install_source', { source })
export const setInstallSource = (source: InstallSource) =>
  invoke<void>('set_install_source', { source })
export const upgradeViaBrew = () => invoke<BrewUpgradeResult>('upgrade_via_brew')
export const externalUpdateInstructions = () =>
  invoke<ExternalUpdateInstructions>('external_update_instructions')

// App self-update (Tauri updater plugin)
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export async function checkAppUpdate(): Promise<Update | null> {
  return await check()
}

export async function applyAppUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall()
  await relaunch()
}

// Diagnostics
export const reportFrontendError = (message: string, stack?: string) =>
  invoke<void>('report_frontend_error', { message, stack })
export const openLogsFolder = () => invoke<void>('open_logs_folder')
