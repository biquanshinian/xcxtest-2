/**
 * 重写 30 篇产品技巧（gallery 结构：标题+封面引用+分节）
 * node .cursor/skills/oa-update-log/scripts/gen-product-tips-30.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '../../../..')
const OUT = path.join(ROOT, 'docs', 'wechat-oa', 'product-tips-2026-08')

const tips = [
  {
    slug: '01-首页倒计时',
    title: '打开小程序，先看下一场火箭还要多久',
    coverHint: 'countdown clock and rocket night launch pad',
    body: `想知道下一场火箭还有多久升空？打开「火星探索日志」，首页最显眼的就是倒计时。

你会看到下一场任务的名字、大概时间，以及还剩多少天、多少小时。点进卡片，还能看更细的介绍。

## 怎么用

1. 微信搜「火星探索日志」打开小程序  
2. 看首页大倒计时和任务卡片  
3. 点卡片进入详情

## 小技巧

刚打开时如果数字在跳，等一两秒就稳了。想看别的任务，往下划，首页还有更多卡片。`
  },
  {
    slug: '02-即将和历史',
    title: '一会儿看要飞的，一会儿看飞过的',
    coverHint: 'two panels upcoming vs history rocket missions',
    body: `首页可以切换「即将」和「历史」。

- **即将**：后面要飞的任务，方便你提前盯着  
- **历史**：已经飞过的，适合回看结果

## 怎么用

在首页顶部切换列表，点任意一条进详情。收藏、设提醒也在详情里。

适合那种「既想追下一场，又想翻翻上周飞得怎么样」的人。`
  },
  {
    slug: '03-发射日历',
    title: '用日历一眼扫完这个月的发射',
    coverHint: 'calendar with rocket icons on days',
    body: `不想一条条翻列表？用发射日历。

按日期看哪天有发射，点某一天就能跳到对应任务。

## 怎么用

从首页相关入口进日历 → 左右翻月份 → 点有标记的日期。

出差、周末想安排追发射时，先翻日历更快。`
  },
  {
    slug: '04-搜索任务',
    title: '记得名字就搜，搜不到就换关键词',
    coverHint: 'search bar over starry sky rockets',
    body: `任务太多翻不过来？用搜索。

可以试着搜：任务名、火箭名、发射公司、发射场。输几个字就会出结果。

## 小技巧

记不清全名时，搜一半也行，比如只搜火箭名字或发射场名字。`
  },
  {
    slug: '05-任务详情',
    title: '点进一场发射，该看的都在这一页',
    coverHint: 'phone screen mission detail rocket card',
    body: `任意任务点进去，就是详情页。

这里一般有：倒计时或结果、基本介绍、收藏、提醒、回放入口，有的还有现场观礼入口。

## 建议新手顺序

先收藏关心的任务 → 再开提醒 → 发射日回来看结果或回放。`
  },
  {
    slug: '06-发射提醒',
    title: '怕错过发射？给任务打开提醒',
    coverHint: 'notification bell with rocket silhouette',
    body: `不想盯着手机等？在任务详情里打开提醒。

可以在发射前收到通知，有的也能收到结果通知。「我的」里还能统一管理你开过的提醒。

## 小技巧

只给真正关心的几场开提醒，避免消息太多。`
  },
  {
    slug: '07-发射竞猜',
    title: '猜一猜：这场会不会准时、会不会成功',
    coverHint: 'friendly vote cards success on-time',
    body: `有的任务支持竞猜：猜会不会准时飞、会不会成功。

选好你的判断，等结果出来后可以回看战绩。就是图个热闹，顺带多留意一场发射。

## 怎么用

进任务详情 → 找到竞猜入口 → 选好选项提交。`
  },
  {
    slug: '08-每日简报',
    title: '一分钟看完今天的太空动静',
    coverHint: 'morning briefing card space news',
    body: `每天打开小程序，可以先看「每日太空简报」。

里面会汇总今天有什么发射、昨天结果怎样。想看细一点，再点进独立简报页。

适合早起通勤、午休刷一眼的节奏。`
  },
  {
    slug: '09-系统公告',
    title: '首页公告别划走，有时有重要通知',
    coverHint: 'announcement banner soft glow',
    body: `首页可能会出现系统公告，比如活动、重要说明。

有的公告还能投票。看到就点开看一眼，比事后到处找消息省事。

如果公告带按钮，按提示点就行。`
  },
  {
    slug: '10-空间站',
    title: '想看看空间站现在忙不忙',
    coverHint: 'space station above earth night',
    body: `在「监控」相关页面，可以看国际空间站、天宫空间站等概况。

用来回答一句很简单的问题：天上的空间站最近大概在干什么。

打开看看状态和介绍即可，不用背名词。`
  },
  {
    slug: '11-星链地图',
    title: '地图上看看星链卫星大概在哪',
    coverHint: 'earth map with satellite constellation dots',
    body: `想知道星链卫星在天上的大致分布？打开星链相关地图。

你会看到它们大致在哪一带，心里有个画面。

晚上去户外看星前，可以先打开瞄一眼。`
  },
  {
    slug: '12-星链过境',
    title: '今晚星链什么时候从你头顶过',
    coverHint: 'night sky train of satellites over city',
    body: `星链过境预报会按你的位置，算出近期能看见的大概时间和方向。

## 怎么用

先允许定位（或选好城市）→ 看列表里的时间 → 天气好、天够黑时出门。

提前几分钟到户外，比卡点出门从容。`
  },
  {
    slug: '13-手机找星链',
    title: '举起手机，对着天找星链',
    coverHint: 'hand holding phone AR sky night',
    body: `有实景找星功能时，举起手机对着天空，屏幕会帮你对准方向。

适合第一次看星链、分不清哪条亮线是什么的人。

注意安全：路边站稳再举，别边走边看。`
  },
  {
    slug: '14-发射区域地图',
    title: '发射前后，地图上哪些区域要注意',
    coverHint: 'coastal map with highlighted zones',
    body: `有的发射会在地图上标出相关区域，方便了解大致范围。

普通人用来「心里有数」就够了：这场发射大概影响哪一带。

点开地图后可以放大缩小，配合任务详情一起看更清楚。`
  },
  {
    slug: '15-图鉴随便翻',
    title: '像翻相册一样看火箭、飞船、发射场',
    coverHint: 'illustrated rocket encyclopedia cards',
    body: `图鉴里可以浏览发射公司、火箭、飞船、发射场。

不知道从哪场任务看起时，先翻图鉴建立印象，再回到首页找具体发射。

当百科随手翻就很好，不用一次记完。`
  },
  {
    slug: '16-星舰进展',
    title: '星舰最近在干什么，进展页一刷就有',
    coverHint: 'starship prototype desert launch site',
    body: `想追星舰建造、测试、飞行消息？打开星舰进展相关页面。

按时间线刷图文和视频，比东拼西凑消息省心。

重要更新可以收藏，回头好找。`
  },
  {
    slug: '17-基地与封路',
    title: '去基地附近？先看地图和封路通知',
    coverHint: 'road closed sign near coastal base',
    body: `星舰基地地图可以看相关位置。若有道路封闭，封路通知和地图会告诉你。

准备路过或旅行路过时，先看一眼，少走冤枉路。

以页面最新说明为准，出行前再确认一次。`
  },
  {
    slug: '18-地球仪追踪',
    title: '在地球仪上找正在飞的飞船',
    coverHint: '3d earth globe with glowing spacecraft path',
    body: `打开在轨飞行器追踪，可以在地球画面上看到正在飞的相关飞船位置。

适合喜欢「看它现在飞到哪了」的人。转一转、放大缩小，找到你关心的那一艘。

加载需要一点时间，耐心等两秒。`
  },
  {
    slug: '19-星舰互动关',
    title: '玩一把：你来决定继续飞还是停下',
    coverHint: 'game like control panel continue or stop',
    body: `星舰互动关卡里，你可以扮演做决定的人：遇到节点时选择继续还是停下。

不用背术语，按屏幕提示选就行，图个沉浸感。

想认真了解飞行过程，可以再去看飞行过程演示页。`
  },
  {
    slug: '20-事件和文章',
    title: '刷事件流，顺便读几篇航天文章',
    coverHint: 'news feed cards space photography',
    body: `「事件」相关页面有航天动态流，也有整理好的文章。

碎片时间刷事件；想看完整故事就点文章。

看到感兴趣的，可以收藏或分享给朋友。`
  },
  {
    slug: '21-航天摄影',
    title: '看别人拍的火箭，也可以投稿你的照片',
    coverHint: 'camera lens rocket night long exposure',
    body: `航天摄影页像瀑布流相册，刷爱好者拍的作品。

你自己拍到好看的发射或星空，也可以按页面提示投稿上传。

上传前看清说明，选最能代表现场的一张。`
  },
  {
    slug: '22-通行证',
    title: '星际通行证是干什么的（白话版）',
    coverHint: 'membership pass card star badge',
    body: `星际通行证就是会员。开通后，常见权益包括：星问多聊、少看广告、过境相关能力、专属徽章等（以页面展示为准）。

如果你经常问星问、常用过境预报，通行证会更划算。

开通入口在「我的」里，点进去看当前权益说明即可。`
  },
  {
    slug: '23-签到知识卡',
    title: '每天签到，顺手收一张太空知识卡',
    coverHint: 'daily check-in card space fact',
    body: `在「我的」里可以每日签到，顺带领当天的太空知识卡。

坚持签到能攒天数，知识卡用来随手学一点小常识。

打开小程序先签，十秒就结束。`
  },
  {
    slug: '24-成就徽章',
    title: '点亮徽章，给自己的追发射之路留个纪念',
    coverHint: 'achievement badges wall space theme',
    body: `成就徽章记录你在小程序里的各种足迹。

完成相应行为就可能点亮新徽章，打开徽章页慢慢欣赏。

当收集乐趣就好，不必强求一次点亮全部。`
  },
  {
    slug: '25-收藏和旅程',
    title: '收藏夹 + 太空旅程：把足迹收在一起',
    coverHint: 'timeline journey path stars',
    body: `「我的收藏」集中放你收藏过的任务等内容。

「太空旅程」会把签到、答题、提醒等串成时间线，有的还能生成海报。

周末回顾一下自己追过哪些发射，挺有成就感。`
  },
  {
    slug: '26-每日挑战',
    title: '每天答几道太空小问题',
    coverHint: 'quiz cards playful space',
    body: `每日挑战是轻松问答，考一点太空小知识。

答完就结束，当休息时的小游戏。和签到、知识卡一起做，节奏刚刚好。`
  },
  {
    slug: '27-邀请好友',
    title: '请朋友打开小程序，有机会拿月卡',
    coverHint: 'friends invite share card',
    body: `邀请活动开启时，请好友打开「火星探索日志」，按规则攒次数，有机会自动获得通行证月卡。

入口一般在「我的」相关活动页。把活动说明看清楚再分享。

真诚分享比刷屏更有效：告诉朋友你最爱用的一个功能就行。`
  },
  {
    slug: '28-消息提醒号',
    title: '关注提醒号，发射前后手机自己响',
    coverHint: 'wechat message notification rocket',
    body: `想更稳地收到发射前和结果通知，可以按页面指引关注提醒号。

关注后，提醒会走微信消息，不必一直开着小程序。

记得在系统设置里允许微信通知，否则可能收不到声音。`
  },
  {
    slug: '29-现场观礼',
    title: '想去现场看火箭？先在小程序预约',
    coverHint: 'people rooftop watching rocket launch distant',
    body: `火箭观礼开放时，可以在小程序里选场次和商家，预约到现场看发射，并可导航到点。

到场后有的活动还能抽奖，奖品在「我的奖品」里查看。

出行前看清集合时间、地点和须知，现场听工作人员安排。`
  },
  {
    slug: '30-星问助手',
    title: '不会找功能？直接问「星问」',
    coverHint: 'chat bubbles AI assistant space',
    body: `星问是小程序里的问答助手。用平时说话的方式问就行，比如：

- 这周有什么发射？
- 星舰最近怎样了？
- 今晚星链什么时候过？
- 观礼怎么预约？

它会尽量结合小程序里的信息回答，有的还能弹出卡片让你一键跳转。

问得越具体，回答越好用。微信搜「火星探索日志」打开就能试。`
  }
]

function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const meta = []
  for (const t of tips) {
    const dir = path.join(OUT, t.slug)
    fs.mkdirSync(dir, { recursive: true })
    const md =
      `# ${t.title}\n\n` +
      `![封面](cover.jpg)\n\n` +
      `${t.body.trim()}\n\n` +
      `---\n\n微信搜「火星探索日志」，打开小程序就能用。\n`
    fs.writeFileSync(path.join(dir, 'article.md'), md, 'utf8')
    meta.push({ slug: t.slug, title: t.title, coverHint: t.coverHint, dir })
  }
  fs.writeFileSync(path.join(OUT, '_covers-meta.json'), JSON.stringify(meta, null, 2))
  console.log('WROTE', tips.length, 'tips →', OUT)
}

main()
