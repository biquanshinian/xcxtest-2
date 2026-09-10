/**
 * 知识卡 CRUD + 小程序公开列表。从 adminGateway/index.js 抽出，降低误改推送/会员的概率。
 */
function createKnowledgeCardsApi({ db, _, ok, fail, now, writeOpLog, COLLECTIONS }) {
  async function listKnowledgeCards(query = {}) {
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 50)))
    const keyword = (query.keyword || '').trim()

    let dbQuery
    if (keyword) {
      dbQuery = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).where(
        _.or([
          { fact: db.RegExp({ regexp: keyword, options: 'i' }) },
          { category: db.RegExp({ regexp: keyword, options: 'i' }) }
        ])
      )
    } else {
      dbQuery = db.collection(COLLECTIONS.KNOWLEDGE_CARDS)
    }

    const [countRes, listRes] = await Promise.all([
      dbQuery.count(),
      dbQuery.orderBy('cardId', 'asc').skip((page - 1) * pageSize).limit(pageSize).get()
    ])
    return ok({ list: listRes.data || [], total: countRes.total, page, pageSize })
  }

  async function createKnowledgeCard(body, user) {
    const payload = {
      cardId: Number(body.cardId || 0),
      category: body.category || '',
      fact: body.fact || '',
      source: body.source || '',
      enabled: body.enabled !== false,
      createdAt: now(),
      updatedAt: now(),
      createdBy: user.username,
      updatedBy: user.username
    }
    const res = await db.collection(COLLECTIONS.KNOWLEDGE_CARDS).add({ data: payload })
    await writeOpLog({ user, module: 'knowledge_cards', action: 'create', targetId: res._id, after: payload })
    return ok({ id: res._id })
  }

  async function updateKnowledgeCard(id, body, user) {
    if (!id) return fail(4001, 'id不能为空')
    const ref = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).doc(id)
    const beforeRes = await ref.get().catch(() => null)
    if (!beforeRes?.data) return fail(4040, '数据不存在')

    const patch = {}
    const fields = ['cardId', 'category', 'fact', 'source', 'enabled']
    fields.forEach(f => { if (body[f] !== undefined) patch[f] = body[f] })
    if (patch.cardId !== undefined) patch.cardId = Number(patch.cardId)
    patch.updatedAt = now()
    patch.updatedBy = user.username

    await ref.update({ data: patch })
    await writeOpLog({ user, module: 'knowledge_cards', action: 'update', targetId: id, before: beforeRes.data, after: { ...beforeRes.data, ...patch } })
    return ok(true)
  }

  async function deleteKnowledgeCard(id, user) {
    if (!id) return fail(4001, 'id不能为空')
    const ref = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).doc(id)
    const beforeRes = await ref.get().catch(() => null)
    if (!beforeRes?.data) return fail(4040, '数据不存在')

    await ref.remove()
    await writeOpLog({ user, module: 'knowledge_cards', action: 'delete', targetId: id, before: beforeRes.data, after: null })
    return ok(true)
  }

  async function getPublicKnowledgeCards() {
    const allCards = []
    let lastId = ''
    while (true) {
      let q = db.collection(COLLECTIONS.KNOWLEDGE_CARDS).where({ enabled: true }).orderBy('cardId', 'asc').limit(100)
      if (lastId) q = q.where({ _id: _.gt(lastId) })
      const res = await q.get()
      if (!res.data || res.data.length === 0) break
      allCards.push(...res.data)
      lastId = res.data[res.data.length - 1]._id
      if (res.data.length < 100) break
    }
    return ok(allCards)
  }

  async function batchImportKnowledgeCards(body, user) {
    const cards = body.cards
    if (!Array.isArray(cards) || cards.length === 0) return fail(4001, '无有效卡片数据')
    let imported = 0
    for (const card of cards) {
      await db.collection(COLLECTIONS.KNOWLEDGE_CARDS).add({
        data: {
          cardId: Number(card.id || card.cardId || 0),
          category: card.category || '',
          fact: card.fact || '',
          source: card.source || '',
          enabled: true,
          createdAt: now(),
          updatedAt: now(),
          createdBy: user.username,
          updatedBy: user.username
        }
      })
      imported++
    }
    await writeOpLog({ user, module: 'knowledge_cards', action: 'batch_import', targetId: 'batch', after: { count: imported } })
    return ok({ imported })
  }

  return {
    listKnowledgeCards,
    createKnowledgeCard,
    updateKnowledgeCard,
    deleteKnowledgeCard,
    getPublicKnowledgeCards,
    batchImportKnowledgeCards
  }
}

module.exports = { createKnowledgeCardsApi }
