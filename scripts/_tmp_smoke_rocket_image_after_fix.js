/**
 * 冒烟：utils/config.js 恢复后，getRocketImage 能拼出可用的 COS 直链。
 * mock 最小 wx 环境后加载 utils/util.js。
 * 运行：node scripts/_tmp_smoke_rocket_image_after_fix.js
 */
const storage = Object.create(null)

global.wx = {
  getStorageSync: (k) => (k in storage ? storage[k] : ''),
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  getStorageInfoSync: () => ({ keys: Object.keys(storage) }),
  getFileSystemManager: () => ({
    accessSync: () => { throw new Error('noent') },
    access: (o) => { if (o && o.fail) o.fail() },
    statSync: () => { throw new Error('noent') },
    readdir: (o) => { if (o && o.fail) o.fail() },
    mkdirSync: () => {},
    unlink: () => {},
    unlinkSync: () => {},
    stat: (o) => { if (o && o.fail) o.fail() }
  }),
  env: { USER_DATA_PATH: 'wxfile://usr' },
  downloadFile: () => ({ abort: () => {} }),
  getNetworkType: (o) => { if (o && o.success) o.success({ networkType: 'wifi' }) },
  onNetworkStatusChange: () => {},
  getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.0.0' }),
  getAppBaseInfo: () => ({ SDKVersion: '3.0.0' }),
  canIUse: () => false,
  cloud: {}
}
global.getApp = () => ({ globalData: {} })
global.getCurrentPages = () => []

const { getRocketImage, isDefaultRocketSrc } = require('../utils/util.js')

let failed = 0
function check(name, cond, extra) {
  if (cond) console.log('ok  ', name, extra ? `→ ${extra}` : '')
  else { failed++; console.log('FAIL', name, extra || '') }
}

const f9 = getRocketImage('Falcon 9')
check('Falcon 9 返回非空', !!f9, f9)
check('Falcon 9 是 http/wxfile 地址', /^(https?:|wxfile:)/.test(String(f9)), f9)

const cz7a = getRocketImage('Long March 7A')
check('Long March 7A 返回非空', !!cz7a, cz7a)

const unknown = getRocketImage('Totally Unknown Rocket XYZ')
check('未知火箭回退 default 占位（非空）', !!unknown && isDefaultRocketSrc(unknown), unknown)

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
