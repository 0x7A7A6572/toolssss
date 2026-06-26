<script setup lang="ts">
import { ref, watch } from 'vue'
import type { UpdateFrequency } from '@shared/custom-modules'
import AppSwitch from '@renderer/components/AppSwitch.vue'
import { useAgentBackend } from '@renderer/composables/useAgentBackend'
import { Save, X, Sparkles } from 'lucide-vue-next'
export interface ModuleDialogData {
  name: string
  type: 'text' | 'ranking' | 'link' | 'chart'
  prompt: string
  webSearch: boolean
  minHeight: number
  maxHeight: number | 'auto'
  enableMarkdown: boolean
  updateFrequency: UpdateFrequency
}

const props = withDefaults(
  defineProps<{
    open: boolean
    mode: 'add' | 'edit'
    initialName?: string
    initialType?: 'text' | 'ranking' | 'link' | 'chart'
    initialPrompt?: string
    initialWebSearch?: boolean
    initialMinHeight?: number
    initialMaxHeight?: number | 'auto'
    initialEnableMarkdown?: boolean
    initialUpdateFrequency?: UpdateFrequency
  }>(),
  {
    initialName: '',
    initialType: 'text',
    initialPrompt: '',
    initialWebSearch: false,
    initialMinHeight: 180,
    initialMaxHeight: 300,
    initialEnableMarkdown: false,
    initialUpdateFrequency: 'daily'
  }
)

const emit = defineEmits<{
  close: []
  saved: [data: ModuleDialogData]
}>()

const optionsModelTypes: { label: string; value: 'text' | 'ranking' | 'link' | 'chart' }[] = [
  { label: '生成文字', value: 'text' },
  { label: '数据排行', value: 'ranking' },
  { label: '数据图表', value: 'chart' },
  { label: '资讯简报', value: 'link' }
]

const draftName = ref('')
const draftType = ref<'text' | 'ranking' | 'link' | 'chart'>('text')
const draftPrompt = ref('')
const draftWebSearch = ref(false)
const draftMinHeight = ref<number>(180)
const draftMaxHeightValue = ref<number>(300)
const draftMaxHeightUnlimited = ref(false)
const draftEnableMarkdown = ref(false)
const draftUpdateFrequency = ref<UpdateFrequency>('daily')
const draftSaving = ref(false)
const draftError = ref('')
const draftAiEnhancing = ref(false)

function resetForm(): void {
  draftName.value = props.initialName
  draftType.value = props.initialType
  draftPrompt.value = props.initialPrompt
  draftWebSearch.value = props.initialWebSearch
  draftMinHeight.value = props.initialMinHeight
  draftMaxHeightValue.value =
    typeof props.initialMaxHeight === 'number' ? props.initialMaxHeight : 300
  draftMaxHeightUnlimited.value = props.initialMaxHeight === 'auto'
  draftEnableMarkdown.value = props.initialEnableMarkdown
  draftUpdateFrequency.value = props.initialUpdateFrequency
  draftSaving.value = false
  draftError.value = ''
  draftAiEnhancing.value = false
}

watch(
  () => props.open,
  (v) => {
    if (v) resetForm()
  }
)

function close(): void {
  if (draftSaving.value) return
  emit('close')
}

function validate(): string {
  if (!draftName.value.trim()) return '请输入模块名称'
  if (!draftPrompt.value.trim()) return '请输入提示词'
  return ''
}

async function aiEnhancePrompt(): Promise<void> {
  const title = draftName.value.trim()
  const prompt = draftPrompt.value.trim()
  if (!title && !prompt) {
    draftError.value = '请至少输入模块名称或提示词'
    return
  }
  draftAiEnhancing.value = true
  draftError.value = ''
  try {
    const backend = useAgentBackend()
    const result = await backend.enhance(title, prompt, draftType.value)
    if (result && result.enhanced.trim()) {
      draftPrompt.value = result.enhanced.trim()
    }
  } catch (e) {
    draftError.value = e instanceof Error ? e.message : 'AI 补充失败'
  } finally {
    draftAiEnhancing.value = false
  }
}

function save(): void {
  const err = validate()
  if (err) {
    draftError.value = err
    return
  }
  draftSaving.value = true
  draftError.value = ''
  try {
    emit('saved', {
      name: draftName.value.trim(),
      type: draftType.value,
      prompt: draftPrompt.value.replace(/\r\n/g, '\n').trim(),
      webSearch: draftWebSearch.value,
      minHeight: draftMinHeight.value,
      maxHeight: draftMaxHeightUnlimited.value ? 'auto' : draftMaxHeightValue.value,
      enableMarkdown: draftEnableMarkdown.value,
      updateFrequency: draftUpdateFrequency.value
    })
  } finally {
    draftSaving.value = false
  }
}
</script>

<template>
  <a-modal
    :open="open"
    centered
    :closable="false"
    :footer="null"
    wrap-class-name="module-dialog-modal"
    @cancel="close"
  >
    <template #title>
      <div class="modal-header">
        <div class="flex items-center gap-[10px]">
          <div class="bg-[#a0c5f3] w-[4px] h-[15px]"></div>
          <span class="modal-title">{{ mode === 'add' ? '添加模块' : '编辑模块' }}</span>
        </div>

        <div class="modal-header-actions">
          <div class="btn-style" @click="save">
            <Save :size="16" />
          </div>
          <div class="btn-style" @click="close">
            <X :size="16" />
          </div>

          <!-- <a-button size="small" :disabled="draftSaving" >取消</a-button>
          <a-button size="small" type="primary" :loading="draftSaving"">
            {{ mode === 'add' ? '添加' : '保存' }}
          </a-button> -->
        </div>
      </div>
      <div v-if="draftError" class="error">{{ draftError }}</div>
    </template>
    <div class="module-dialog-form">
      <div class="flex gap-[10px]">
        <div
          v-for="item in optionsModelTypes"
          :key="item.value"
          class="overflow-hidden border-solid relative p-[10px] rounded-[4px]"
          :style="{
            backgroundColor: draftType === item.value ? '#a0c5f366' : '#ffffff22',
            borderColor: draftType === item.value ? '#a0c5f3' : 'transparent'
          }"
          @click="draftType = item.value"
        >
          <div class="module-dialog-label flex items-center gap-[10px]">
            <!-- <div class="bg-[#a0c5f3] w-[4px] h-[15px] rounded-md"></div> -->
            <span
              class="font-bold font-italic"
              :style="{
                color: draftType === item.value ? '#a0c5f3' : 'white'
              }"
              >{{ item.label }}</span
            >
          </div>
        </div>
      </div>

      <div class="module-dialog-field">
        <div class="module-dialog-label">模块名称</div>
        <a-input v-model:value="draftName" placeholder="例如：前端技术栈排行" />
      </div>

      <div class="module-dialog-field">
        <div class="module-dialog-row">
          <div class="module-dialog-label">提示词</div>
          <button
            class="icon-btn"
            type="button"
            :disabled="draftAiEnhancing"
            title="AI补充"
            @click="aiEnhancePrompt"
          >
            <span v-if="draftAiEnhancing" class="ai-enhance-spinner"></span>
            <Sparkles v-else :size="14" />
          </button>
        </div>
        <div class="relative overflow-hidden rounded-md">
          <!-- <view class="textarea-bar absolute bottom-[0px] left-[0px] z-10 bg-[#bee5ff3a] w-full">
            <button
              class="ai-enhance-btn"
              type="button"
              :disabled="draftAiEnhancing"
              @click="aiEnhancePrompt"
            >
              <span v-if="draftAiEnhancing" class="ai-enhance-spinner"></span>
              {{ draftAiEnhancing ? '补充中…' : 'AI补充' }}
            </button>
          </view> -->

          <a-textarea
            v-model:value="draftPrompt"
            class="module-dialog-textarea"
            :rows="6"
            :placeholder="
              draftType === 'ranking'
                ? '输入你希望AI生成排行榜的主题，如：2025年最流行的前端框架'
                : draftType === 'link'
                  ? '输入你希望AI收集的资讯主题，如：近期AI行业重大新闻'
                  : draftType === 'chart'
                    ? '输入你希望AI生成图表的数据主题，如：2025年主流前端框架使用率对比'
                    : '输入你希望AI生成的内容主题'
            "
          >
          </a-textarea>
        </div>
      </div>
      <div class="module-dialog-field">
        <div class="module-dialog-row">
          <label class="module-dialog-label">联网搜索</label>
          <AppSwitch v-model="draftWebSearch" :checked-value="true" />
        </div>
      </div>
      <div class="module-dialog-field">
        <div class="module-dialog-label">更新频率</div>
        <a-segmented
          v-model:value="draftUpdateFrequency"
          :options="[
            { label: '实时', value: 'realtime' },
            { label: '每天', value: 'daily' },
            { label: '每周', value: 'weekly' },
            { label: '每月', value: 'monthly' }
          ]"
        />
        <div class="module-dialog-hint">
          实时：每次页面加载时自动更新；其他：在有效期内使用缓存内容，可手动刷新
        </div>
      </div>

      <!-- <a-collapse ghost :style="{ background: 'transparent', padding: 0 }">
        <a-collapse-panel key="advanced" header="高级设置">
          <div class="advanced-body">
            <div class="module-dialog-field">
              <div class="module-dialog-row">
                <label class="module-dialog-label">模块最低高度 (px)</label>
                <a-input-number
                  v-model:value="draftMinHeight"
                  :min="120"
                  :max="600"
                  :step="20"
                  size="small"
                  style="width: 100px"
                />
              </div>
            </div>

            <div class="module-dialog-field">
              <div class="module-dialog-row">
                <label class="module-dialog-label">模块最大高度</label>
                <div class="max-height-row">
                  <a-input-number
                    v-model:value="draftMaxHeightValue"
                    :min="100"
                    :max="1200"
                    :step="50"
                    :disabled="draftMaxHeightUnlimited"
                    size="small"
                    style="width: 90px"
                  />
                  <span class="max-height-unit">px</span>
                  <AppSwitch v-model="draftMaxHeightUnlimited" :checked-value="true" />
                  <span class="max-height-label">不限制</span>
                </div>
              </div>
            </div>

            <div v-if="draftType === 'text'" class="module-dialog-field">
              <div class="module-dialog-row">
                <label class="module-dialog-label">启用 Markdown 渲染</label>
                <AppSwitch v-model="draftEnableMarkdown" :checked-value="true" />
              </div>
            </div>
          </div>
        </a-collapse-panel>
      </a-collapse> -->
      <div class="advanced-body">
        <div class="module-dialog-field">
          <div class="module-dialog-row">
            <label class="module-dialog-label">模块最低高度 (px)</label>
            <a-input-number
              v-model:value="draftMinHeight"
              :min="120"
              :max="600"
              :step="20"
              size="small"
              style="width: 100px"
            />
          </div>
        </div>

        <div class="module-dialog-field">
          <div class="module-dialog-row">
            <label class="module-dialog-label">模块最大高度</label>
            <div class="max-height-row flex items-center bg-[#43434344] rounded-sm p-[5px]">
              <a-input-number
                v-model:value="draftMaxHeightValue"
                :min="100"
                :max="1200"
                :step="50"
                :disabled="draftMaxHeightUnlimited"
                size="small"
                style="width: 90px; border: none"
              />
              <span class="max-height-unit">PX</span>
              <span>|</span>
              <span class="max-height-label">不限制</span>
              <AppSwitch v-model="draftMaxHeightUnlimited" :checked-value="true" />
            </div>
          </div>
        </div>

        <div v-if="draftType === 'text'" class="module-dialog-field">
          <div class="module-dialog-row">
            <label class="module-dialog-label">启用 Markdown 渲染</label>
            <AppSwitch v-model="draftEnableMarkdown" :checked-value="true" />
          </div>
        </div>
      </div>
    </div>
  </a-modal>
</template>

<style lang="scss" scoped>
.picker-title {
  font-size: 14px;
  font-weight: 700;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  position: sticky;
  top: 0;
}

.modal-title {
  font-size: 15px;
  font-weight: 700;
}

.modal-header-actions {
  display: flex;
  gap: 8px;
  font-size: 14px;
}

.module-dialog-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 10px;
  height: 500px;
  display: flex;
  flex-direction: column;
  height: 500px;
  overflow-y: auto;

  /* Chrome / Safari / Edge */
  &::-webkit-scrollbar {
    display: none;
  }

  /* Firefox */
  scrollbar-width: none;
  /* IE / 旧 Edge */
  -ms-overflow-style: none;
}

.module-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.module-dialog-label {
  font-size: 13px;
  color: rgba(235, 235, 245, 0.72);
  font-weight: 700;
}

.module-dialog-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.module-dialog-textarea {
  min-height: 140px;
  resize: vertical;
  line-height: 18px;
}

.module-dialog-hint {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.45);
  line-height: 1.4;
  margin-top: 2px;
}

.max-height-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.max-height-unit {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.45);
}

.max-height-label {
  font-size: 12px;
  color: rgba(235, 235, 245, 0.55);
}

.module-dialog-advanced {
  display: flex;
  flex-direction: column;
}

.advanced-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 6px 0 0 0;
}

.ai-enhance-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(99, 102, 241, 0.85);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
  z-index: 1;
}

.ai-enhance-btn:hover:not(:disabled) {
  background: rgba(99, 102, 241, 0.2);
  border-color: rgba(99, 102, 241, 0.6);
  color: rgba(99, 102, 241, 1);
}

.ai-enhance-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-enhance-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(99, 102, 241, 0.3);
  border-top-color: rgba(99, 102, 241, 0.85);
  border-radius: 50%;
  animation: ai-enhance-spin 0.6s linear infinite;
}

.error {
  font-size: 13px;
  color: #ff8a8a;
}

@keyframes ai-enhance-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style lang="scss">
.module-dialog-modal {
  .ant-modal {
    border-radius: 8px;
    padding-bottom: 0;
    overflow: hidden;
  }

  // .ant-modal-content {
  //   height: 600px;
  //   display: flex;
  //   flex-direction: column;
  //   overflow-y: scroll;
  // }

  // .ant-modal-body {
  //   flex: 1;
  //   overflow-y: auto;
  // }
}
</style>
