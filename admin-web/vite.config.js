import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'html-no-crossorigin',
      transformIndexHtml(html) {
        return html.replace(/ crossorigin/g, '')
      }
    }
  ],
  build: {
    modulePreload: { polyfill: false },
    commonjsOptions: {
      include: [/node_modules/, /cloudfunctions[\\/]adminGateway[\\/]oaNewspicCaption/]
    }
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
    exclude: ['heic-to']
  },
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/cos-proxy': {
        target: 'https://mars-1397421562.cos.ap-guangzhou.myqcloud.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/cos-proxy/, '')
      }
    }
  }
})
