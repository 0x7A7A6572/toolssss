<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const logoUrl = new URL('../../../../../resources/icon.png', import.meta.url).href
const version = ref('')
type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'error'
    | 'unsupported'
  hasUpdate: boolean
  version: string | null
  percent: number | null
  message: string | null
}
const update = ref<UpdateState | null>(null)
const updateText = computed(() => {
  const u = update.value
  if (!u) return ''
  if (u.status === 'unsupported') return '当前环境不支持自动更新'
  if (u.status === 'checking') return '正在检查更新…'
  if (u.status === 'not-available') return '已是最新版本'
  if (u.status === 'available') return u.version ? `发现新版本 v${u.version}` : '发现新版本'
  if (u.status === 'downloading') {
    const p = typeof u.percent === 'number' ? Math.round(u.percent) : null
    return p !== null ? `正在下载更新… ${p}%` : '正在下载更新…'
  }
  if (u.status === 'downloaded') return '更新已下载，重启即可安装'
  if (u.status === 'error') return u.message ? `更新失败：${u.message}` : '更新失败'
  return ''
})
const canCheckUpdate = computed(() => {
  const s = update.value?.status
  return s !== 'checking' && s !== 'downloading'
})
const canInstallUpdate = computed(() => update.value?.status === 'downloaded')

function onUpdateStatus(_: unknown, payload: unknown): void {
  if (!payload || typeof payload !== 'object') return
  const p = payload as Partial<UpdateState>
  if (typeof p.status !== 'string') return
  update.value = {
    status: p.status as UpdateState['status'],
    hasUpdate: Boolean(p.hasUpdate),
    version: typeof p.version === 'string' ? p.version : null,
    percent: typeof p.percent === 'number' ? p.percent : null,
    message: typeof p.message === 'string' ? p.message : null
  }
}

async function checkUpdate(): Promise<void> {
  try {
    const ret = await window.electron.ipcRenderer.invoke('update:check')
    onUpdateStatus(null, ret)
  } catch {
    void 0
  }
}

async function installUpdate(): Promise<void> {
  try {
    await window.electron.ipcRenderer.invoke('update:install')
  } catch {
    void 0
  }
}

type Faq = {
  q: string
  a: string
}

const faqs: Faq[] = [
  {
    q: 'toolsss 是什么？',
    a: '一个桌面端工具箱，把常用小工具集中到一个地方，减少你在应用之间来回切换。'
  },
  {
    q: '它会收集我的数据吗？',
    a: '默认以本地能力为主。涉及网络能力（比如翻译/AI）只在你配置并使用时发生请求。'
  }
]

onMounted(() => {
  window.electron.ipcRenderer
    .invoke('app:version')
    .then((v: unknown) => {
      version.value = typeof v === 'string' ? v : ''
    })
    .catch(() => null)
  window.electron.ipcRenderer
    .invoke('update:status:get')
    .then((v: unknown) => onUpdateStatus(null, v))
    .catch(() => null)
  window.electron.ipcRenderer.on('update:status', onUpdateStatus)
  void checkUpdate()
})

onBeforeUnmount(() => {
  window.electron.ipcRenderer.removeListener('update:status', onUpdateStatus)
})
</script>

<template>
  <div class="landing">
    <section class="about card">
      <div class="about-left">
        <img class="about-logo" :src="logoUrl" alt="TOOLSSSS" />
        <div class="about-meta">
          <div class="about-title">
            TOOLSSSS
            <span v-if="update?.hasUpdate" class="about-dot" />
          </div>
          <div class="about-sub">版本 {{ version || '-' }}</div>
        </div>
      </div>
      <div class="about-right">
        <button class="btn" type="button" :disabled="!canCheckUpdate" @click="checkUpdate">
          检查更新
        </button>
        <button v-if="canInstallUpdate" class="btn primary" type="button" @click="installUpdate">
          重启更新
        </button>
      </div>
    </section>
    <div v-if="updateText" class="about-status">{{ updateText }}</div>

    <section class="hero card">
      <div class="hero-main">
        <div class="kicker">TOOLSSSS</div>
        <h1 class="hero-title">把碎片工具变成一套工作流</h1>
        <p class="hero-subtitle">
          便签、截屏贴图、翻译、脚本库……你需要的不是更多工具，而是更少切换。
        </p>

        <!-- <div class="cta">
          <button class="btn primary" type="button" @click="go('/other-tools')">
            立即开始
            <ArrowRight class="btn-icon" />
          </button>
          <button class="btn" type="button" @click="go('/settings')">全局设置</button>
        </div> -->
      </div>

      <!-- <div class="hero-side">
        <div class="stat-grid">
          <div class="stat">
            <div class="stat-title">目标</div>
            <div class="stat-value">减少切换</div>
            <div class="stat-desc">把“找工具”这件事从工作里删掉。</div>
          </div>
          <div class="stat">
            <div class="stat-title">原则</div>
            <div class="stat-value">简单优先</div>
            <div class="stat-desc">少概念、少状态、少特殊情况。</div>
          </div>
          <div class="stat">
            <div class="stat-title">体验</div>
            <div class="stat-value">随开随用</div>
            <div class="stat-desc">工具不该需要“学习成本”。</div>
          </div>
          <div class="stat">
            <div class="stat-title">边界</div>
            <div class="stat-value">不打扰</div>
            <div class="stat-desc">该安静的时候就安静。</div>
          </div>
        </div>
      </div> -->
    </section>

    <!-- <section class="section">
      <header class="section-head">
        <div class="section-title">一键直达</div>
        <div class="section-subtitle">落地页不是展示页，是入口。</div>
      </header>

      <div class="grid three">
        <button
          v-for="i in quickLinks"
          :key="i.title"
          class="card link-card"
          type="button"
          @click="go(i.path)"
        >
          <div class="link-head">
            <div class="feature-icon">
              <component :is="i.icon" />
            </div>
            <div class="feature-title">{{ i.title }}</div>
          </div>
          <div class="feature-desc">{{ i.desc }}</div>
        </button>
      </div>
    </section> -->

    <!-- <section class="section">
      <header class="section-head">
        <div class="section-title">核心功能</div>
        <div class="section-subtitle">围绕真实工作流设计，而不是堆功能。</div>
      </header>

      <div class="grid">
        <div v-for="f in features" :key="f.title" class="feature card">
          <div class="feature-icon">
            <component :is="f.icon" />
          </div>
          <div class="feature-title">{{ f.title }}</div>
          <div class="feature-desc">{{ f.desc }}</div>
        </div>
      </div>
    </section> -->

    <!-- <section class="section">
      <header class="section-head">
        <div class="section-title">为什么是它</div>
        <div class="section-subtitle">把“特殊情况”变成“正常情况”。</div>
      </header>

      <div class="grid two">
        <div v-for="p in points" :key="p.title" class="card point">
          <div class="point-head">
            <div class="feature-icon">
              <component :is="p.icon" />
            </div>
            <div class="feature-title">{{ p.title }}</div>
          </div>
          <div class="feature-desc">{{ p.desc }}</div>
        </div>
      </div>
    </section> -->

    <section class="section">
      <header class="section-head">
        <div class="section-title">常见问题</div>
        <!-- <div class="section-subtitle">如果你还有问题，那就是我们没把东西做简单。</div> -->
      </header>

      <div class="faq">
        <div v-for="f in faqs" :key="f.q" class="card qa">
          <div class="q">{{ f.q }}</div>
          <div class="a">{{ f.a }}</div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.landing {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.about {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.about-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.about-logo {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
}

.about-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.about-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 900;
  font-size: 14px;
  color: rgba(255, 255, 245, 0.92);
}

.about-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.95);
  box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25);
}

.about-sub {
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.about-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.about-status {
  font-size: 12px;
  color: var(--ev-c-text-3);
}

.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
}

.hero {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 14px;
  position: relative;
  overflow: hidden;
}

.hero::before {
  content: '';
  position: absolute;
  inset: -120px -120px auto auto;
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.35), rgba(59, 130, 246, 0) 60%);
  pointer-events: none;
}

.kicker {
  font-size: 12px;
  letter-spacing: 0.12em;
  color: rgba(235, 235, 245, 0.6);
  text-transform: uppercase;
  font-weight: 700;
}

.hero-title {
  margin-top: 8px;
  font-size: 34px;
  line-height: 1.15;
  font-weight: 800;
  color: rgba(255, 255, 245, 0.92);
}

.hero-subtitle {
  margin-top: 10px;
  max-width: 52ch;
  font-size: 14px;
  color: rgba(235, 235, 245, 0.6);
}

.cta {
  margin-top: 14px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btn {
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 245, 0.92);
  font-size: 13px;
  font-weight: 800;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn.primary {
  border-color: rgba(59, 130, 246, 0.55);
  background: rgba(59, 130, 246, 0.18);
}

.btn-icon {
  width: 16px;
  height: 16px;
}

.hero-side {
  display: flex;
  align-items: stretch;
}

.stat-grid {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.stat {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
}

.stat-title {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.6);
  font-weight: 700;
}

.stat-value {
  margin-top: 2px;
  font-size: 16px;
  font-weight: 900;
  color: rgba(255, 255, 245, 0.92);
}

.stat-desc {
  margin-top: 6px;
  font-size: 12px;
  color: rgba(235, 235, 245, 0.38);
  line-height: 1.5;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.section-title {
  font-size: 16px;
  font-weight: 900;
  color: rgba(255, 255, 245, 0.92);
}

.section-subtitle {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.6);
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.feature {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.feature-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.14);
  border: 1px solid rgba(59, 130, 246, 0.35);
  display: inline-grid;
  place-items: center;
  color: rgba(235, 235, 245, 0.86);
}

.feature-icon :deep(svg) {
  width: 18px;
  height: 18px;
}

.feature-title {
  font-size: 13px;
  font-weight: 900;
  color: rgba(255, 255, 245, 0.92);
}

.feature-desc {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.6);
  line-height: 1.55;
}

.link-card {
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.link-card:hover {
  border-color: rgba(59, 130, 246, 0.35);
  background: rgba(59, 130, 246, 0.07);
}

.link-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.point {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.point-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.faq {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qa {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.q {
  font-size: 13px;
  font-weight: 900;
  color: rgba(255, 255, 245, 0.92);
}

.a {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.6);
  line-height: 1.55;
}

@media (max-width: 980px) {
  .hero {
    grid-template-columns: 1fr;
  }
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid.three {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 620px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .grid.two {
    grid-template-columns: 1fr;
  }
  .grid.three {
    grid-template-columns: 1fr;
  }
}
</style>
