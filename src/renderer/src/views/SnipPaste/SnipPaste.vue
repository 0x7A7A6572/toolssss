<template>
  <div class="page-content">
    <header class="header">
      <div class="title">截屏贴图</div>
      <div class="subtitle">开始截图（系统截图） + 剪贴板贴图置顶</div>
    </header>

    <section class="card">
      <div class="card-title">截屏</div>
      <div class="kv">
        <div class="k">开始截图</div>
        <div class="v">
          <div>快捷键（默认 F1）</div>
        </div>
      </div>
      <div class="kv">
        <div class="k">取消截图</div>
        <div class="v">
          <div>任何时刻按 Esc</div>
          <div>任何时刻点击工具条上的关闭按钮</div>
        </div>
      </div>
      <div class="hint">
        当前版本通过系统截图（Windows：ms-screenclip）完成选区，截图结果在系统剪贴板中。
      </div>
    </section>

    <section class="card">
      <div class="card-title">贴图</div>
      <div class="paragraph">
        所谓贴图，是指将系统剪贴板中的内容转化成图片/颜色/文本，然后作为窗口置顶显示。
      </div>

      <div class="kv">
        <div class="k">如何贴图</div>
        <div class="v">
          <div>快捷键（默认 F3）</div>
          <div>截图后复制到剪贴板，再按贴图键</div>
        </div>
      </div>

      <div class="kv">
        <div class="k">基础操作</div>
        <div class="v">
          <div>缩放：滚轮 / + -</div>
          <div>透明度：Ctrl + 滚轮</div>
          <div>旋转：1 2</div>
          <div>翻转：3 4</div>
          <div>关闭：Esc / 左键双击</div>
          <div>隐藏/显示所有贴图：默认 Shift + F3</div>
        </div>
      </div>
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

.kv {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 10px;
  align-items: start;
}

.k {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.7);
}

.v {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.86);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.paragraph {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.86);
  line-height: 20px;
}

.hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.62);
  line-height: 18px;
}
</style>
