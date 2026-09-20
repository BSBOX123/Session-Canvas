import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function compilerOptions(configName: string): ts.CompilerOptions {
  const configPath = resolve(repoRoot, configName)
  const { config, error } = ts.readConfigFile(configPath, ts.sys.readFile)
  expect(error).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, dirname(configPath))
  expect(parsed.errors).toEqual([])
  return parsed.options
}

// SPEC 0.5: TypeScript strict everywhere. This guards the setting itself, so a
// later refactor cannot silently drop it.
describe('typescript configuration', () => {
  it.each(['tsconfig.node.json', 'tsconfig.web.json'])('%s enables strict mode', (name) => {
    expect(compilerOptions(name).strict).toBe(true)
  })
})
