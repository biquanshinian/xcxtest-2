<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 85 57" fill="none" width="48" height="32"><path d="M18.215445,2.220227L3.0127578,2.220227C1.695654,2.220227,0.57675987,3.0237782,0.16733406,4.263732C-0.24215524,5.503624,0.18097524,6.8068008,1.2434014,7.5777974L19.784561,21.032907C20.615595,21.635979,21.609751,21.776314,22.57777,21.427326C26.915979,19.863525,29.844072,17.982981,32.047157,15.111856C32.554928,14.450213,32.748951,13.697948,32.624146,12.876106C32.499222,12.054203,32.090172,11.391869,31.408312,10.907513L19.960058,2.7757246C19.429382,2.398773,18.868446,2.2201018,18.215385,2.2201018L18.215445,2.220227ZM53.590393,46.050011L64.861053,54.208569C65.395912,54.595695,65.965034,54.779781,66.627495,54.779781L82.000534,54.779781C83.317139,54.779781,84.435646,53.976864,84.84552,52.737587C85.255447,51.498268,84.833275,50.195461,83.771919,49.423779L65.244278,35.954086C64.412865,35.349693,63.417316,35.208729,62.448338,35.558338C58.111668,37.122643,55.181137,38.997978,52.977551,41.855968C52.470413,42.513714,52.274242,43.26152,52.393955,44.080593C52.513687,44.89967,52.915817,45.561691,53.590454,46.05006L53.590393,46.050011ZM31.407412,46.051582L20.138912,54.208569C19.604046,54.595695,19.034927,54.779781,18.372473,54.779781L2.9994934,54.779781C1.6828973,54.779781,0.5643841,53.976864,0.15445058,52.737587C-0.25541937,51.498268,0.16669591,50.195461,1.2280434,49.423779L19.753914,35.955463C20.585384,35.351013,21.581005,35.210056,22.550098,35.559723C26.884375,37.123653,29.814503,38.998161,32.019745,41.856785C32.527195,42.51453,32.723499,43.262463,32.603966,44.081665C32.484364,44.900925,32.082172,45.563202,31.407412,46.051582L31.407412,46.051582ZM66.784462,2.220227L81.987152,2.220227C83.304184,2.220227,84.423073,3.0237782,84.832565,4.2637339C85.24205,5.503624,84.818855,6.8068023,83.756424,7.5777974L65.214317,21.033596C64.383408,21.636606,63.389324,21.777008,62.421364,21.428146C58.083157,19.864594,55.154041,17.983862,52.951527,15.111417C52.444138,14.44971,52.250313,13.69763,52.375294,12.87598C52.500229,12.054329,52.909275,11.392183,53.591019,10.907953L65.039841,2.7757876C65.57058,2.3988359,66.131447,2.2202277,66.784523,2.2202277L66.784462,2.220227ZM13.7273,28.492243C33.490833,24.037018,37.983288,19.560297,42.507843,0C47.002769,19.563375,51.520348,24.039593,71.272667,28.492243C51.528286,32.971348,47.003792,37.432358,42.507851,56.999996C37.982464,37.436131,33.483662,32.974121,13.7273,28.492243L13.7273,28.492243Z" fill="#FFFFFF"/></svg>
      </div>
      <h2 class="login-title">火星探索日志</h2>
      <p class="login-subtitle">未来太空数据舱</p>

      <el-form :model="form" @submit.prevent class="login-form">
        <div class="form-field">
          <label class="field-label">用户名</label>
          <el-input v-model="form.username" placeholder="请输入用户名" size="large" />
        </div>
        <div class="form-field">
          <label class="field-label">密码</label>
          <el-input v-model="form.password" type="password" show-password placeholder="请输入密码" size="large" @keyup.enter="onLogin" />
        </div>
        <div class="form-field">
          <label class="field-label">验证码</label>
          <div class="captcha-row">
            <el-input v-model="form.captchaCode" placeholder="请输入验证码" size="large" maxlength="6" @keyup.enter="onLogin" />
            <button type="button" class="captcha-img" :title="captchaLoading ? '加载中...' : '点击刷新'" @click="refreshCaptcha" :disabled="captchaLoading">
              <img v-if="captcha.svg" :src="captcha.svg" alt="captcha" />
              <span v-else class="captcha-placeholder">{{ captchaLoading ? '加载中' : '点击获取' }}</span>
            </button>
          </div>
        </div>
        <el-button type="primary" :loading="loading" @click="onLogin" size="large" class="login-btn">登录</el-button>
      </el-form>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'

const router = useRouter()
const loading = ref(false)
const captchaLoading = ref(false)
const captcha = reactive({ id: '', svg: '' })
const form = reactive({ username: '', password: '', captchaCode: '' })

const refreshCaptcha = async () => {
  if (captchaLoading.value) return
  captchaLoading.value = true
  try {
    const data = await api.getCaptcha()
    captcha.id = data.captchaId
    captcha.svg = data.svg
    form.captchaCode = ''
  } catch (e) {
    ElMessage.error(e.message || '验证码获取失败')
  } finally {
    captchaLoading.value = false
  }
}

onMounted(refreshCaptcha)

const onLogin = async () => {
  if (!form.username || !form.password) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  if (!form.captchaCode) {
    ElMessage.warning('请输入验证码')
    return
  }
  if (!captcha.id) {
    await refreshCaptcha()
    return
  }
  loading.value = true
  try {
    const data = await api.login({
      username: form.username,
      password: form.password,
      captchaId: captcha.id,
      captchaCode: form.captchaCode
    })
    localStorage.setItem('admin_token', data.token)
    localStorage.setItem('admin_user', JSON.stringify(data.user))
    ElMessage.success('登录成功')
    router.replace('/dashboard')
  } catch (e) {
    ElMessage.error(e.message || '登录失败')
    refreshCaptcha()
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-wrap {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  position: relative;
  overflow: hidden;
}

.login-card {
  width: 380px;
  max-width: 92vw;
  padding: 48px 36px 40px;
  background: rgba(18, 21, 38, 0.55);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  text-align: center;
  position: relative;
  z-index: 1;
  box-shadow: 0 20px 60px rgba(2, 6, 23, 0.6), 0 0 0 1px rgba(139, 92, 246, 0.08);
}

.login-card::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 20px;
  background: linear-gradient(135deg, rgba(99,102,241,0.35), rgba(168,85,247,0.10) 50%, transparent 100%);
  z-index: -1;
  opacity: 0.6;
  filter: blur(8px);
}

.login-logo {
  margin-bottom: 16px;
}

.login-title {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 4px;
  letter-spacing: 2px;
  color: #FFFFFF;
}

.login-subtitle {
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
  margin: 0 0 32px;
  letter-spacing: 2px;
}

.login-form {
  text-align: left;
}

.form-field {
  margin-bottom: 20px;
}

.field-label {
  display: block;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 6px;
}

.login-form :deep(.el-input__wrapper) {
  background: rgba(255, 255, 255, 0.04);
  box-shadow: none;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  height: 44px;
  transition: border-color 0.2s, background 0.2s;
}

.login-form :deep(.el-input__inner) {
  color: #fff;
}

.login-form :deep(.el-input__wrapper:hover) {
  border-color: rgba(139, 92, 246, 0.55);
}

.login-form :deep(.el-input__wrapper.is-focus) {
  border-color: #8B5CF6;
  background: rgba(139, 92, 246, 0.06);
}

.login-btn {
  width: 100%;
  height: 44px;
  margin-top: 8px;
  border: 0 !important;
  border-radius: 12px !important;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 1px;
  background: linear-gradient(135deg, #6366F1 0%, #8B5CF6 50%, #A855F7 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 24px rgba(99, 102, 241, 0.35);
  position: relative;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.login-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 28px rgba(139, 92, 246, 0.45);
}

.login-btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.25) 50%, transparent 100%);
  transform: translateX(-100%);
  transition: transform 0.6s ease;
  pointer-events: none;
}

.login-btn:hover::after {
  transform: translateX(100%);
}

.captcha-row {
  display: flex;
  gap: 10px;
  align-items: stretch;
}

.captcha-row :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.captcha-img {
  width: 120px;
  height: 44px;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  padding: 0;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.2s, background 0.2s;
}

.captcha-img:hover {
  border-color: rgba(139, 92, 246, 0.55);
}

.captcha-img:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.captcha-img img {
  width: 100%;
  height: 100%;
  display: block;
}

.captcha-placeholder {
  color: rgba(255, 255, 255, 0.55);
  font-size: 12px;
  letter-spacing: 1px;
}
</style>
