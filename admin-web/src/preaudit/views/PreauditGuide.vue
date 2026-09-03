<template>
  <div class="pa">
    <div class="pa-card">
      <div class="pa-row">
        <p class="pa-title pa-grow">村委会 · 7 步</p>
        <span class="pa-tag village">材料多</span>
      </div>
      <div class="pa-sub">上传的照片会存云端。拍照或上传后会自动认日期金额；也可扫一扫，扫拍图不保存。</div>
      <div class="pa-item" v-for="(line, i) in village" :key="'v' + i">
        <div class="pa-step on">{{ i + 1 }}</div>
        <div class="pa-grow">{{ line }}</div>
      </div>
      <div class="pa-actions">
        <el-button type="primary" @click="$router.push('/preaudit/new?org=village')">去建村委会项目</el-button>
      </div>
    </div>

    <div class="pa-card" style="margin-top: 12px;">
      <div class="pa-row">
        <p class="pa-title pa-grow">村委会小额 · 4 步</p>
        <span class="pa-tag small">最简单</span>
      </div>
      <div class="pa-sub">上传的照片会存云端。拍照或上传后会自动认日期金额；也可扫一扫，扫拍图不保存。</div>
      <div class="pa-item" v-for="(line, i) in small" :key="'s' + i">
        <div class="pa-step small">{{ i + 1 }}</div>
        <div class="pa-grow">{{ line }}</div>
      </div>
      <div class="pa-actions">
        <el-button type="primary" @click="$router.push('/preaudit/new?org=small')">去建小额项目</el-button>
      </div>
    </div>

    <div class="pa-card" style="margin-top: 12px;">
      <div class="pa-row">
        <p class="pa-title pa-grow">乡政府 · 8 步</p>
        <span class="pa-tag town">前面更简</span>
      </div>
      <div class="pa-sub">上传的照片会存云端。拍照或上传后会自动认日期金额；也可扫一扫，扫拍图不保存。</div>
      <div class="pa-item" v-for="(line, i) in town" :key="'t' + i">
        <div class="pa-step town">{{ i + 1 }}</div>
        <div class="pa-grow">{{ line }}</div>
      </div>
      <div class="pa-actions">
        <el-button type="primary" @click="$router.push('/preaudit/new?org=township')">去建乡政府项目</el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import '../preaudit.css'

const village = [
  '开会：审批表、四议纪要、专题会议（记录含签到）',
  '墙上公示：两张同框照。决议公示和实施方案公示一张（决议公示须写起止、满 7 天，不能只写 7 天），实施结果公示和实施方案公示一张（结果公示须写起止、满 7 天，起始日须为验收次日或之后）',
  '乡镇批文：请示批复、同意上网招标',
  '网上采购：可不上传，点确认即可。有扫描件仍可传',
  '合同证照：可不上传，点确认即可。有扫描件仍可传',
  '现场照片：施工前、中、后、现场验收各至少 1 张，不用填日期。上传后会自动摆正，也可手动旋转。施工照可备注对应工程名称，填了才印在 A4 上。可生成 A4 彩打，弹窗选 JPG 或 PDF。验收单可扫一扫认日期和金额',
  '发票：可不上传，点确认即可。单村须和合同一致；两村打包须按本村实施结果分开开票，两村金额之和等于中标总价'
]
const small = [
  '预算金额报价',
  '三家公司比价：高价、中价、低价各一框，不核日期；低价公司名称和金额须能和发票对齐',
  '施工前、中、后现场照片各至少 1 张，不用填日期，不要验收单。上传后会自动摆正，也可手动旋转',
  '开对应发票：金额和销售方须与比价低价一致'
]
const town = [
  '审批表',
  '使用实施方案：日期和金额可写可不写，没有也不影响核验',
  '关于乡政府的请示：日期和申请金额可扫一扫同时认上',
  '方案说明：报价、签到、纪要、决议公示、结果公开（结果公开须写起止、满 7 天，起始日须为验收次日或之后，不能只写 7 天）',
  '网上采购：可不上传，点确认即可。有扫描件仍可传',
  '合同证照：可不上传，点确认即可。有扫描件仍可传',
  '现场照片：施工前、中、后、现场验收各至少 1 张，不用填日期。上传后会自动摆正，也可手动旋转。验收到场至少 1 人即可，不必确认监督员。施工照可备注对应工程名称，填了才印在 A4 上。可生成 A4 彩打，弹窗选 JPG 或 PDF。验收单可扫一扫认日期和金额',
  '发票：可不上传，点确认即可。金额必须和合同一致'
]
</script>
