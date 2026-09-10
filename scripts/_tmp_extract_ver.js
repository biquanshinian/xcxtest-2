const fs = require('fs')
const t = fs.readFileSync('C:\\Users\\huyuz\\AppData\\Local\\微信开发者工具\\User Data\\7688c56cc354c78cdae20cfaa2781e38\\WeappLocalData\\localstorage_b0f4109a3f102cf2700334322fa3c4c5.json', 'utf8')
const keys = ['latestVersion', 'uploadInfo', 'lastUploadTime', 'onlineVersion', 'releasedVersion', 'devVersion']
for (const k of keys) {
  const i = t.indexOf(k)
  if (i >= 0) console.log(k, t.slice(i, i + 220))
}
const vers = []
const re = /"version":"(\d+\.\d+\.\d+)"/g
let m
while ((m = re.exec(t))) vers.push(m[1])
console.log('all versions', Array.from(new Set(vers)))
