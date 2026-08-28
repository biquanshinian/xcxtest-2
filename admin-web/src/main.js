import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/theme.css'
import App from './App.vue'
import router from './router'

document.documentElement.classList.add('dark')

createApp(App).use(ElementPlus).use(router).mount('#app')
