#!/usr/bin/env node
/**
 * Cross-platform consumer type-surface check. Run after pnpm build.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const serviceDeclaration = join(root, 'lib', 'types', 'client', 'service.d.ts')
if (!existsSync(serviceDeclaration)) {
  throw new Error("lib/types/client/service.d.ts not found — run 'pnpm build' first")
}

class CheckFailure extends Error {
  constructor(code) {
    super('consumer type check failed')
    this.code = code
  }
}

const work = mkdtempSync(join(tmpdir(), 'dsh-sidebar-consumer-types-'))
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const checkSource = "import { SIDEBAR_FEATURES, SIDEBAR_SERVICE_VERSION } from 'dsh-better-sidebar/client/service'\nimport type {} from 'dsh-better-sidebar/client/service'\nimport type {\n  BetterSidebarService, FileViewerDescriptor, OpenTabSeed, SidebarSettingsRenderProps,\n  TabComponentProps, TabDescriptor,\n} from 'dsh-better-sidebar/client/service'\nimport type { SessionScope, SidebarSnapshot, SidebarState, SidebarStore, SidebarTab } from 'dsh-better-sidebar/client/service'\nimport type { SidebarPrefs } from 'dsh-better-sidebar/client/service'\n\ndeclare const ctx: { betterSidebar: BetterSidebarService }\nconst tab: TabDescriptor = {\n  id: 'x:tab',\n  title: 'X',\n  single: true,\n  badge: (_ctx, _scope, state: SidebarState) => state.expanded.length,\n  onOpen: (_tab: SidebarTab, _scope: SessionScope) => {},\n  onClose: (_tab: SidebarTab, _scope: SessionScope) => {},\n  createTab: (state: SidebarState) => ({ tab: { id: 'x:1', type: 'x:tab', title: 'X', meta: {} } }),\n  settings: {\n    toggles: [{ key: 'autoOpenSubagent', title: 'A' }],\n    pluginToggles: [{ key: 'k', title: 'K', type: 'number', min: 0, max: 9 }],\n    render: (props: SidebarSettingsRenderProps) => { props.updatePluginSetting('a', 1); return null },\n  },\n  component: (props: TabComponentProps) => null,\n}\nctx.betterSidebar.registerTab(tab)\nconst viewer: FileViewerDescriptor = {\n  id: 'x:csv', exts: ['csv'], fetchStrategy: 'custom',\n  load: (_path, _scope, signal?: AbortSignal) => { void signal; return Promise.resolve([]) },\n  component: () => null,\n}\nctx.betterSidebar.registerFileViewer(viewer)\nconst seed: OpenTabSeed = { type: 'x:tab', title: 'X', meta: { a: 1 } }\nctx.betterSidebar.openTab(seed, { sessionId: 's1' })\nctx.betterSidebar.openFile({ sessionId: 's1' }, '/p/a.csv')\nctx.betterSidebar.updateTab('t', { meta: { b: 2 } })\nconst snap: SidebarSnapshot = ctx.betterSidebar.getSnapshot()\nconst prefs: SidebarPrefs = snap.prefs\nconst store: SidebarStore = null as unknown as SidebarStore\nvoid prefs; void store; void ctx.betterSidebar.version; void ctx.betterSidebar.features\nvoid SIDEBAR_SERVICE_VERSION; void SIDEBAR_FEATURES\n"
const tsconfig = {
  compilerOptions: {
    target: 'ES2023',
    module: 'esnext',
    moduleResolution: 'bundler',
    strict: true,
    noEmit: true,
    skipLibCheck: false,
    types: [],
    jsx: 'react-jsx',
    lib: ['ES2023', 'DOM'],
  },
  include: ['check.ts'],
}

function runTsc(extraArgs, capture = false) {
  const result = spawnSync(process.execPath, [tsc, '-p', join(work, 'tsconfig.json'), ...extraArgs], {
    cwd: work,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.signal !== null || result.status === null) {
    throw new Error('TypeScript process terminated without an exit code' + (result.signal ? ': ' + result.signal : ''))
  }
  return result
}

function linkPackage(modules, name) {
  const segments = name.split('/')
  const source = join(root, 'node_modules', ...segments)
  const target = join(modules, ...segments)
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir')
}

try {
  const modules = join(work, 'node_modules')
  const packageRoot = join(modules, 'dsh-better-sidebar')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  cpSync(join(root, 'lib', 'types'), join(packageRoot, 'lib', 'types'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    type: manifest.type,
    exports: manifest.exports,
  }, null, 2) + '\n')
  for (const dependency of ['cordis', 'react', '@types/react']) linkPackage(modules, dependency)
  writeFileSync(join(work, 'check.ts'), checkSource)
  writeFileSync(join(work, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n')

  console.log('[check-consumer-types] type-checking an isolated browser-only consumer (no @types/node)...')
  console.log('[check-consumer-types]   pass 1: skipLibCheck: true (the realistic consumer experience) — must be fully clean')
  const normal = runTsc(['--skipLibCheck', 'true'])
  if (normal.status !== 0) throw new CheckFailure(normal.status)

  console.log('[check-consumer-types]   pass 2: skipLibCheck: false — OUR declaration surface (lib/types/**) must be clean')
  console.log('[check-consumer-types]   (only known cordis/cosmokit declaration diagnostics are allowed)')
  const strict = runTsc(['--skipLibCheck', 'false'], true)
  const output = (strict.stdout ?? '') + (strict.stderr ?? '')
  const lines = output.split(/\r?\n/).filter(Boolean)
  if (strict.status !== 0) {
    const diagnostics = lines.filter(line => /\(\d+,\d+\): error TS\d+:/.test(line))
    const unexpected = diagnostics.filter(line => !/node_modules[\\/](?:cordis|cosmokit)[\\/]/.test(line))
    if (diagnostics.length === 0 || unexpected.length > 0) {
      console.error('[check-consumer-types] FAIL: unexpected strict declaration diagnostics:')
      console.error(output.trim())
      throw new CheckFailure(1)
    }
    console.log('[check-consumer-types] pass 2 note: strict mode only reports known upstream declaration noise:')
    console.log(lines.slice(0, 5).join('\n'))
  }
  console.log('[check-consumer-types] OK: the client/service declaration surface is node-free and self-contained.')
} catch (error) {
  if (error instanceof CheckFailure) process.exitCode = error.code
  else throw error
} finally {
  rmSync(work, { recursive: true, force: true })
}
