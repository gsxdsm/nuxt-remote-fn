import { relative, resolve } from 'node:path'
import { addImports, addServerHandler, addTemplate, addVitePlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import fg from 'fast-glob'
import dedent from 'dedent'
import { createFilter } from '@rollup/pluginutils'
import { getModuleId, transformServerFiles } from './runtime/transformer'

export interface ModuleOptions {
  pattern?: string | string[]
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: 'nuxt-rpc',
    configKey: 'rpc',
    version: '^3.3.0'
  },
  defaults: {
    pattern: '**/server/rpc/**/*.{ts,js,mjs}'
  },
  async setup (options, nuxt) {
    const files: string[] = []

    const filter = createFilter(options.pattern)

    // Transpile runtime and handler
    const resolver = createResolver(import.meta.url)
    const handlerPath = resolver.resolve(nuxt.options.buildDir, 'rpc-handler')
    const runtimeDir = resolver.resolve('./runtime')
    nuxt.options.build.transpile.push(runtimeDir, handlerPath)
    nuxt.options.vite ??= {};
    nuxt.options.vite.optimizeDeps ??= {};
    nuxt.options.vite.optimizeDeps.exclude ??= [];
    nuxt.options.vite.optimizeDeps.exclude.push("nuxt-rpc");
    nuxt.hook('builder:watch', async (e, path) => {
      path = relative(nuxt.options.rootDir, resolve(nuxt.options.rootDir, path))
      if (e === 'change') return
      if (filter(path)) {
        await scanRemoteFunctions()
        await nuxt.callHook('builder:generateApp')
      }
    })

    addServerHandler({
      route: '/api/__rpc/:moduleId/:functionName',
      method: 'post',
      handler: handlerPath
    })

    addVitePlugin(transformServerFiles({ filter }))

    addImports([
      {
        name: 'createClient',
        as: 'createClient',
        from: resolver.resolve(runtimeDir, 'client')
      },
    ])

    await scanRemoteFunctions()

    addTemplate({
      filename: 'rpc-handler.ts',
      write: true,
      getContents () {
        const filesWithId = files.map(file => ({
          file: file.replace(/\.ts$/, ''),
          id: getModuleId(file)
        }))
        return dedent`
          import { createRpcHandler } from ${JSON.stringify(resolver.resolve(runtimeDir, 'server'))}
          ${filesWithId.map(i => `import * as ${i.id} from ${JSON.stringify(i.file)}`).join('\n')}

          export type RemoteFunction = {
            ${filesWithId.map(i => `${i.id}: typeof ${i.id}`).join('\n')}
          }

          export default createRpcHandler({
            ${filesWithId.map(i => i.id).join(',\n')}
          })
        `
      }
    })

    async function scanRemoteFunctions () {
      files.length = 0
      const updatedFiles = await fg(options.pattern!, {
        cwd: nuxt.options.rootDir,
        absolute: true,
        onlyFiles: true,
        ignore: ['!**/node_modules', '!**/dist']
      })
      files.push(...new Set(updatedFiles))
      return files
    }
  }
})
