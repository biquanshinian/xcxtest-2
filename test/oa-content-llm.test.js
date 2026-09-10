const test = require('node:test')
const assert = require('node:assert/strict')
const llm = require('../cloudfunctions/adminGateway/oaContentLlm')

test('extractLLMText：OpenAI / 混元 / 数组 content', () => {
  assert.equal(
    llm.extractLLMText({ choices: [{ message: { content: '# 猎鹰重型\n\n窗口待确认。' } }] }),
    '# 猎鹰重型\n\n窗口待确认。'
  )
  assert.equal(
    llm.extractLLMText({
      Response: { Choices: [{ Message: { Content: '简体中文成稿' } }] }
    }),
    '简体中文成稿'
  )
  assert.equal(
    llm.extractLLMText({
      choices: [{ message: { content: [{ type: 'text', text: '分段正文' }] } }]
    }),
    '分段正文'
  )
  assert.equal(llm.extractLLMText({ output_text: '顶层 output' }), '顶层 output')
})

test('hunyuanProviderChain：主链含 hunyuan-v3 / lite，liteFirst 先 lite', () => {
  const main = llm.hunyuanProviderChain()
  assert.equal(main[0].provider, 'cloudbase')
  assert.equal(main[0].model, 'hy3-preview')
  assert.equal(main[1].provider, 'hunyuan-v3')
  assert.equal(main[2].provider, 'hunyuan-open')
  assert.equal(main[2].model, 'hunyuan-lite')
  const lite = llm.hunyuanProviderChain(true)
  assert.equal(lite[0].provider, 'hunyuan-open')
  assert.ok(lite.some((p) => p.provider === 'hunyuan-v3'))
  assert.equal(lite.some((p) => p.model === 'hy3'), false)
})

test('模型不存在不应当作账号级熔断', () => {
  assert.equal(llm.isModelMissingError('InvalidParameter.Model'), true)
  assert.equal(llm.isAccountFatalLlmError('InvalidParameter.Model'), false)
  assert.equal(llm.isAccountFatalLlmError('欠费'), true)
})
