import Handler from './handler'
import { KCRDB } from './kcrdb'

let reporters: Handler[] = []

const normalizePath = (s: string) => s.replace('/kcsapi/', '')

export const handleRequest = (e: any) => {
  for (const reporter of reporters) {
    try {
      reporter.handleRequest?.(normalizePath(e.detail.path), e.detail.body, e.detail)
    } catch (err) {
      if (err instanceof Error) {
        console.error(err.stack)
      } else {
        console.error(err)
      }
    }
  }
}

export const handleResponse = (e: any) => {
  for (const reporter of reporters) {
    try {
      reporter.handle(normalizePath(e.detail.path), e.detail.body, e.detail.postBody, e.detail)
    } catch (err) {
      if (err instanceof Error) {
        console.error(err.stack)
      } else {
        console.error(err)
      }
    }
  }
}

export const show = false

export const pluginDidLoad = () => {
  reporters = [new KCRDB()]
  window.addEventListener('game.request', handleRequest)
  window.addEventListener('game.response', handleResponse)
}

export const pluginWillUnload = () => {
  reporters = []
  window.removeEventListener('game.request', handleRequest)
  window.removeEventListener('game.response', handleResponse)
}
