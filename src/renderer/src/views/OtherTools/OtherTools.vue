<template>
  <div class="page-content">
    <header class="header">
      <div class="title">其他工具</div>
      <div class="subtitle">预留入口，后续扩展</div>
    </header>

    <section class="card placeholder">
      <div class="card-title">其他工具</div>
      <div class="placeholder-text">这里先预留，后面再往里塞东西。</div>
    </section>
  </div>
</template>

<style scoped>
.page-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 24px;
  font-weight: 700;
  line-height: 28px;
}

.subtitle {
  font-size: 13px;
  color: var(--ev-c-text-2);
}

.card {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--ev-c-text-1);
}

.placeholder {
  flex: 1;
}

.placeholder-text {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.62);
}
</style>