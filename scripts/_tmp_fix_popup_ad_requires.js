const fs = require('fs')
const p = 'components/popup-ad/popup-ad.js'
let s = fs.readFileSync(p, 'utf8')
s = s
  .replace(
    "require('../../../../utils/config.js')",
    "require('../../utils/config.js')"
  )
  .replace(
    "require('../../../../utils/theme.js')",
    "require('../../utils/theme.js')"
  )
  .replace(
    "require('../../utils/store-product-style.js')",
    "require('../../utils/store-product-style.js')"
  )
// If the third replace was already correct from shared path ../../utils/store-product-style
// which from components/popup-ad would wrongly point to components/utils - fix that case:
s = s.replace(
  "require('../../utils/store-product-style.js')",
  "require('../../utils/store-product-style.js')"
)
// Wait: from components/popup-ad, correct path TO utils/store-product-style is ../../utils/
// shared copy had require('../../utils/store-product-style.js') which for shared/components/popup-ad
// resolves to shared/utils - correct for shared.
// For main components/popup-ad, ../../utils = project utils - also correct!
// So store-product-style path is already OK after copy.
// Only config and theme need fix from ../../../../utils to ../../utils

fs.writeFileSync(p, s)
console.log(s.split('\n').slice(0, 7).join('\n'))
