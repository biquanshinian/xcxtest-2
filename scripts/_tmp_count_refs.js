// 统计标识符在文件中的出现次数（词边界）
const fs = require('fs')
const file = process.argv[2]
const s = fs.readFileSync(file, 'utf8')
const keys = process.argv.slice(3)
keys.forEach((k) => {
  const re = new RegExp('\\b' + k + '\\b', 'g')
  const n = (s.match(re) || []).length
  console.log(String(n).padStart(3), k)
})
