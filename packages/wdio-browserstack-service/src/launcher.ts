import { promisify } from 'util'
import { performance, PerformanceObserver } from 'perf_hooks'

import * as BrowserstackLocalLauncher from 'browserstack-local'
import logger from '@wdio/logger'
import type { Capabilities, Services, Options } from '@wdio/types'

// @ts-ignore
import { version as bstackServiceVersion } from '../package.json'
import { getWebdriverIOVersion } from './util'
import { BrowserstackConfig } from './types'

const log = logger('@wdio/browserstack-service')

type BrowserstackLocal = BrowserstackLocalLauncher.Local & {
    pid?: number;
    stop(callback: (err?: any) => void): void;
}

export default class BrowserstackLauncherService implements Services.ServiceInstance {
    browserstackLocal?: BrowserstackLocal

    constructor (
        private _options: BrowserstackConfig | any,
        capabilities: Capabilities.RemoteCapability,
        private _config: Options.Testrunner | any
    ) {
        const webdriverIOVersion: any = getWebdriverIOVersion()
        if (Array.isArray(capabilities)) {
            capabilities.forEach((capability: Capabilities.DesiredCapabilities) => {
                if (capability['bstack:options']) {
                    // if bstack:options present add wdioService inside it
                    capability['bstack:options'].wdioService = bstackServiceVersion
                } else if (webdriverIOVersion >= 7) {
                    // in case of webdriver version 7 we need to add wdioService inside bstack:options,
                    // so need to add bstack:options key first since not present
                    capability['bstack:options'] = { wdioService: bstackServiceVersion }
                } else if (webdriverIOVersion <= 6) {
                    // on webdriver 6 and below can directly add at root level
                    capability['browserstack.wdioService'] = bstackServiceVersion
                }
            })
        } else if (typeof capabilities === 'object') {
            Object.entries(capabilities as Capabilities.MultiRemoteCapabilities).forEach(([, caps]) => {
                if (!(caps.capabilities as Capabilities.Capabilities)['bstack:options']) {
                    (caps.capabilities as Capabilities.Capabilities)['bstack:options'] = {}
                }
                (caps.capabilities as Capabilities.Capabilities)['bstack:options']!.wdioService = bstackServiceVersion
                if ((caps.capabilities as Capabilities.Capabilities)['bstack:options']) {
                    (caps.capabilities as Capabilities.Capabilities)['bstack:options']!.wdioService = bstackServiceVersion
                } else if (webdriverIOVersion >= 7) {
                    (caps.capabilities as Capabilities.Capabilities)['bstack:options'] = { wdioService: bstackServiceVersion }
                } else if (webdriverIOVersion <= 6) {
                    (caps.capabilities as Capabilities.Capabilities)['browserstack.wdioService'] = bstackServiceVersion
                }
            })
        }
    }

    onPrepare (config?: Options.Testrunner, capabilities?: Capabilities.RemoteCapabilities) {
        if (!this._options.browserstackLocal) {
            return log.info('browserstackLocal is not enabled - skipping...')
        }

        const opts = {
            key: this._config.key,
            ...this._options.opts
        }

        this.browserstackLocal = new BrowserstackLocalLauncher.Local()

        if (Array.isArray(capabilities)) {
            capabilities.forEach((capability: Capabilities.DesiredCapabilities) => {
                if (!capability['bstack:options']) {
                    capability['bstack:options'] = {}
                }
                capability['bstack:options'].local = true
            })
        } else if (typeof capabilities === 'object') {
            Object.entries(capabilities as Capabilities.MultiRemoteCapabilities).forEach(([, caps]) => {
                if (!(caps.capabilities as Capabilities.Capabilities)['bstack:options']) {
                    (caps.capabilities as Capabilities.Capabilities)['bstack:options'] = {}
                }
                (caps.capabilities as Capabilities.Capabilities)['bstack:options']!.local = true
            })
        } else {
            throw TypeError('Capabilities should be an object or Array!')
        }

        /**
         * measure TestingBot tunnel boot time
         */
        const obs = new PerformanceObserver((list) => {
            const entry = list.getEntries()[0]
            log.info(`Browserstack Local successfully started after ${entry.duration}ms`)
        })

        obs.observe({ entryTypes: ['measure'] })

        let timer: NodeJS.Timeout
        performance.mark('tbTunnelStart')
        return Promise.race([
            promisify(this.browserstackLocal.start.bind(this.browserstackLocal))(opts),
            new Promise((resolve, reject) => {
                /* istanbul ignore next */
                timer = setTimeout(function () {
                    reject('Browserstack Local failed to start within 60 seconds!')
                }, 60000)
            })]
        ).then(function (result) {
            clearTimeout(timer)
            performance.mark('tbTunnelEnd')
            performance.measure('bootTime', 'tbTunnelStart', 'tbTunnelEnd')
            return Promise.resolve(result)
        }, function (err) {
            clearTimeout(timer)
            return Promise.reject(err)
        })
    }

    onComplete () {
        if (!this.browserstackLocal || !this.browserstackLocal.isRunning()) {
            return
        }

        if (this._options.forcedStop) {
            return process.kill(this.browserstackLocal.pid as number)
        }

        let timer: NodeJS.Timeout
        return Promise.race([
            new Promise<void>((resolve, reject) => {
                this.browserstackLocal?.stop((err: Error) => {
                    if (err) {
                        return reject(err)
                    }
                    resolve()
                })
            }),
            new Promise((resolve, reject) => {
                /* istanbul ignore next */
                timer = setTimeout(
                    () => reject(new Error('Browserstack Local failed to stop within 60 seconds!')),
                    60000
                )
            })]
        ).then(function (result) {
            clearTimeout(timer)
            return Promise.resolve(result)
        }, function (err) {
            clearTimeout(timer)
            return Promise.reject(err)
        })
    }
}
