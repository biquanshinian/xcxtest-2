<template>
  <el-card>
    <template #header>
      <span>纪念卡卡池（已下线）</span>
    </template>
    <el-result
      icon="info"
      title="已迁移为商家现场奖品"
      sub-title="观礼抽奖改为商家在小程序自行配置奖品（照片、名称、数量、选填价值、排序）。平台纪念卡卡池不再使用；请在「场次总览 → 详情」查看各场次奖品配置与库存。"
    >
      <template #extra>
        <el-button type="primary" @click="$router.push('/watch-party')">前往场次总览</el-button>
        <el-button @click="$router.push('/watch-party-merchants')">商家入驻审核</el-button>
      </template>
    </el-result>
  </el-card>
</template>

<script setup>
</script>
