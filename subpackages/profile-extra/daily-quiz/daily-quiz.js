const { getUiShellLayout } = require('../../../utils/layout.js')
const { getThemeClassSync, isLightSync, getPageBgSync } = require('../../../utils/theme.js')
const { getDailyQuestion, answerQuestion, getQuizStats, verifyQuizSave } = require('../utils/space-quiz.js')
const { ROUTES } = require('../../../utils/routes.js')

Page({
  data: {
    statusBarHeight: 44,
    navPlaceholderHeight: 0,
    themeClass: '',
    themeLight: false,
    pageBgColor: '#000000',
    quizQuestion: null,
    quizAnswered: false,
    quizSelectedIndex: -1,
    quizResult: null,
    quizStats: { accuracy: 0, totalAnswered: 0 },
    quizShake: false,
    quizCheckPop: false
  },

  onLoad() {
    const layout = getUiShellLayout()
    this.setData({
      statusBarHeight: layout.statusBarHeight,
      navPlaceholderHeight: layout.navPlaceholderHeight,
      themeClass: getThemeClassSync(),
      themeLight: isLightSync(),
      pageBgColor: getPageBgSync()
    })
    try {
      wx.showShareMenu({ withShareTicket: true, menus: ['shareAppMessage', 'shareTimeline'] })
    } catch (e) {}
    this._load()
  },

  _load() {
    const result = getDailyQuestion()
    const stats = getQuizStats()
    const q = result && result.question
    this.setData({
      quizQuestion: q || null,
      quizAnswered: !!(result && result.alreadyAnswered),
      quizResult:
        result && result.alreadyAnswered && q
          ? { correct: !!result.wasCorrect, explanation: q.explanation || '' }
          : null,
      quizSelectedIndex:
        result && result.alreadyAnswered && result.selectedIndex !== undefined
          ? result.selectedIndex
          : -1,
      quizStats: stats || { accuracy: 0, totalAnswered: 0 }
    })
  },

  onSelect(e) {
    if (this.data.quizAnswered || !this.data.quizQuestion) return
    const index = Number(e.currentTarget.dataset.index)
    if (!Number.isFinite(index)) return
    try { wx.vibrateShort({ type: 'light' }) } catch (err) {}
    const qId = this.data.quizQuestion.id
    const result = answerQuestion(qId, index)
    try { verifyQuizSave() } catch (e2) {}
    const correct = !!(result && result.correct)
    const stats = (result && result.stats) || getQuizStats()
    if (correct) {
      this.setData({
        quizSelectedIndex: index,
        quizAnswered: true,
        quizResult: result,
        quizStats: stats,
        quizCheckPop: true,
        quizShake: false
      })
      return
    }
    this.setData({
      quizSelectedIndex: index,
      quizAnswered: true,
      quizResult: null,
      quizStats: stats,
      quizShake: true,
      quizCheckPop: false
    })
    if (this._quizShakeTimer) clearTimeout(this._quizShakeTimer)
    this._quizShakeTimer = setTimeout(() => {
      this.setData({ quizResult: result, quizShake: false })
      this._quizShakeTimer = null
    }, 280)
  },

  goBack() {
    wx.navigateBack({ delta: 1 })
  },

  onShareAppMessage() {
    return {
      title: '每日太空挑战 · 火星探索日志',
      path: ROUTES.DAILY_QUIZ
    }
  },

  onShareTimeline() {
    return {
      title: '每日太空挑战 · 火星探索日志',
      query: ''
    }
  }
})
