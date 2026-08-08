const fs = require('fs')
const f = 'pages/profile/profile.wxml'
let s = fs.readFileSync(f, 'utf8')
const start = s.indexOf('    <!-- ══ 我的提醒 ══ -->')
const endMark = '    <view style="height: {{tabBarReservedHeight}}px;"></view>'
const end = s.indexOf(endMark)
if (start < 0 || end < 0 || end <= start) { console.error('标记未找到', start, end); process.exit(1) }
const replacement = `    <!-- ══ 我的提醒 / 竞猜战绩 / 每日问答 / 在线客服：profile-extra 分包组件 ══
         纯展示组件，状态由页面下发；交互经单一 sectionevent 通道回传（detail: { name, dataset, edetail }） -->
    <profile-sections
      my-reminders="{{myReminders}}"
      oa-alert-enabled="{{oaAlertEnabled}}"
      oa-alert-followed="{{oaAlertFollowed}}"
      oa-alert-ready="{{oaAlertReady}}"
      oa-alert-message="{{oaAlertMessage}}"
      oa-alert-loading="{{oaAlertLoading}}"
      vote-stats="{{voteStats}}"
      vote-history="{{voteHistory}}"
      vote-history-expanded="{{voteHistoryExpanded}}"
      quiz-question="{{quizQuestion}}"
      quiz-answered="{{quizAnswered}}"
      quiz-selected-index="{{quizSelectedIndex}}"
      quiz-result="{{quizResult}}"
      quiz-stats="{{quizStats}}"
      about-text="{{aboutText}}"
      about-wechat="{{aboutWechat}}"
      figma-share-enabled="{{figmaShareEnabled}}"
      bind:sectionevent="onProfileSectionEvent"
    />

`
s = s.slice(0, start) + replacement + s.slice(end)
fs.writeFileSync(f, s)
console.log('OK, 新文件大小:', (s.length / 1024).toFixed(1) + 'KB')
