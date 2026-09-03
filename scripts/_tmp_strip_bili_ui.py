# -*- coding: utf-8 -*-
from pathlib import Path
import re

root = Path(r"C:\Users\huyuz\Desktop\xcxtest-2")

# --- GlobalConfigPage.vue ---
p = root / "admin-web/src/views/GlobalConfigPage.vue"
t = p.read_text(encoding="utf-8")
t2, n = re.subn(
    r"\n    <el-card class=\"section-card bili-card\".*?</el-card>\n",
    "\n",
    t,
    count=1,
    flags=re.S,
)
# remove bili reactive/state and functions
patterns = [
    r"\nconst biliHealth = reactive\(\{.*?\n\}\)\n",
    r"\nconst biliForm = reactive\(\{.*?\n\}\)\n",
    r"\nconst biliSaving = ref\(.*?\n",
    r"\nconst biliEnqueueing = ref\(.*?\n",
    r"\nconst biliResetting = ref\(.*?\n",
    r"\nconst biliAutoPaused = computed\(\(\) =>[\s\S]*?\n\)\n",
    r"\nconst formatTs = \(t\) => .*?\n",
    r"\nconst loadBili = async \(\) => \{[\s\S]*?\n\}\n",
    r"\nconst onBiliToggle = async \(val\) => \{[\s\S]*?\n\}\n",
    r"\nconst saveBiliAdvanced = async \(\) => \{[\s\S]*?\n\}\n",
    r"\nconst onBiliResetFails = async \(\) => \{[\s\S]*?\n\}\n",
    r"\nconst onBiliBackdate = async \(\) => \{[\s\S]*?\n\}\n",
    r"\nconst onBiliEnqueue = async \(\) => \{[\s\S]*?\n\}\n",
]
for pat in patterns:
    t2, c = re.subn(pat, "\n", t2, count=1, flags=re.S)
    print("pat", pat[:40], "->", c)
t2 = t2.replace("  await loadBili()\n", "")
# remove bili CSS
t2, c = re.subn(r"\n\.bili-header \{[\s\S]*?(?=\n\.|\n</style>)", "\n", t2, count=1)
print("css", c)
# also remove remaining .bili-* blocks until style ends - already one big block hopefully
# clean orphan bili styles leftover
while True:
    t3, c = re.subn(r"\n\.bili-[^{]+\{[\s\S]*?\n\}\n", "\n", t2, count=1)
    if not c:
        break
    t2 = t3
    print("extra css removed")
p.write_text(t2, encoding="utf-8")
print("GlobalConfigPage done, card_removed=", n)

# --- StarshipEventUpdatesPage.vue ---
p = root / "admin-web/src/views/StarshipEventUpdatesPage.vue"
t = p.read_text(encoding="utf-8")
t = re.sub(
    r"\n          <el-select v-model=\"query\.bilibiliSyncStatus\"[\s\S]*?</el-select>\n",
    "\n",
    t,
    count=1,
)
t = re.sub(
    r"\n      <el-table-column label=\"B站同步\"[\s\S]*?</el-table-column>\n      <el-table-column label=\"B站动态\"[\s\S]*?</el-table-column>\n",
    "\n",
    t,
    count=1,
)
t = t.replace(", bilibiliSyncStatus: ''", "")
t = re.sub(r"\nconst biliStatusLabel = \(s\) => \{[\s\S]*?\n\}\n", "\n", t, count=1)
t = re.sub(r"\nconst biliTagType = \(s\) => \{[\s\S]*?\n\}\n", "\n", t, count=1)
p.write_text(t, encoding="utf-8")
print("StarshipEventUpdatesPage done")

# --- Layout / router / client ---
p = root / "admin-web/src/views/LayoutPage.vue"
t = p.read_text(encoding="utf-8")
t = t.replace(
    '        <el-menu-item v-if="hasPerm(\'global_config\')" index="/bilibili-topics">B站话题词库</el-menu-item>\n',
    "",
)
t = t.replace("    '/bilibili-topics': 'B站话题词库',\n", "")
p.write_text(t, encoding="utf-8")

p = root / "admin-web/src/router/index.js"
t = p.read_text(encoding="utf-8")
t = re.sub(
    r"\s*\{ path: 'bilibili-topics', component: \(\) => import\('\.\./views/BilibiliTopicsPage\.vue'\), meta: \{ perm: 'global_config' \} \},\n?",
    "\n",
    t,
    count=1,
)
p.write_text(t, encoding="utf-8")

p = root / "admin-web/src/api/client.js"
t = p.read_text(encoding="utf-8")
t = re.sub(
    r"\n  getBilibiliAutoPublish\(\) \{[\s\S]*?removeBilibiliTopicBlacklist\(id\) \{\n    return request\(`/bilibili-topic-blacklist/\$\{id\}`, \{ method: 'DELETE' \}\)\n  \}\n",
    "\n",
    t,
    count=1,
)
p.write_text(t, encoding="utf-8")
print("admin-web refs cleaned")
