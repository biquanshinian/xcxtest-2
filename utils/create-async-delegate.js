/**
 * 主包 require.async + attachTo 委托工厂。
 * load() 必须由调用方写字面量 require.async('...path...')，
 * 不能把路径传进工厂再 async（开发者工具静态分析认不出变量路径）。
 *
 * @param {{
 *   methods: string[],
 *   attachedKey: string,
 *   methodsKey: string,
 *   promiseKey: string,
 *   load: function(): Promise<any>,
 *   resetPromiseOnError?: boolean,
 *   guard?: function(string, object): *
 * }} opts
 * @returns {Object<string, function>}
 */
function createAsyncDelegates(opts) {
  const methods = opts.methods
  const attachedKey = opts.attachedKey
  const methodsKey = opts.methodsKey
  const promiseKey = opts.promiseKey
  const load = opts.load
  const resetPromiseOnError = opts.resetPromiseOnError !== false
  const guard = opts.guard
  const delegates = {}
  for (let i = 0; i < methods.length; i++) {
    const name = methods[i]
    delegates[name] = function (...args) {
      if (typeof guard === 'function') {
        const blocked = guard(name, this)
        if (blocked !== undefined) return blocked
      }
      const page = this
      const run = () => {
        const fnImpl = page[methodsKey] && page[methodsKey][name]
        if (typeof fnImpl === 'function') return fnImpl.apply(page, args)
        return page[name](...args)
      }
      if (page[attachedKey] && page[methodsKey]) return run()
      if (!page[promiseKey]) {
        let p = load().then((mod) => {
          mod.attachTo(page)
          page[methodsKey] = (mod && mod.methods) || page[methodsKey]
          return mod
        })
        if (resetPromiseOnError) {
          p = p.catch((err) => {
            page[promiseKey] = null
            throw err
          })
        }
        page[promiseKey] = p
      }
      return page[promiseKey].then(() => run())
    }
  }
  return delegates
}

module.exports = {
  createAsyncDelegates
}
