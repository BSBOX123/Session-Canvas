import { contextBridge } from 'electron'

/**
 * The renderer never touches Node APIs directly (SPEC 10/11); everything goes
 * through this bridge. The surface is filled in from stage 1 onwards.
 */
const api = {}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}
