<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type {
  FinalResult,
  PaperRecord,
  PreviewImageItem,
  ResultRecord,
  ScoreBreakdownItem,
} from '@preload/contracts';
import MarkdownRenderer from '@/components/MarkdownRenderer.vue';
import { toImageSrc } from '@/utils/file';
import { computeDisplayedTotal } from '@/utils/result';

const route = useRoute();
const projectName = ref('');
const paper = ref<PaperRecord | null>(null);
const result = ref<
  | (ResultRecord & {
      finalResult: FinalResult;
      modelResult: NonNullable<ResultRecord['modelResult']>;
    })
  | null
>(null);
const errorMessage = ref('');

const projectId = computed(() => String(route.params.projectId ?? ''));
const paperId = computed(() => String(route.params.paperId ?? ''));
const token = computed(() => String(route.query.token ?? ''));
const finalResult = computed(() => result.value?.finalResult ?? null);
const displayedTotal = computed(() =>
  finalResult.value ? computeDisplayedTotal(finalResult.value) : 0,
);
const selectedResultUsesLatestReference = computed(
  () => result.value?.referenceAnswerVersion === latestReferenceAnswerVersion.value,
);
const latestReferenceAnswerVersion = ref(1);
let renderSequence = 0;

const previewImages = computed<PreviewImageItem[]>(() => {
  if (!paper.value || !result.value || !finalResult.value) {
    return [];
  }

  const scoreMap = new Map(
    finalResult.value.questionScores.map((question) => [
      question.questionId,
      {
        score: question.score,
        maxScore: question.maxScore,
      },
    ]),
  );

  return paper.value.originalPages.map((page, index) => ({
    src: page.scannedPath || page.originalPath,
    cacheKey: page.scannedPath ? page.scannedVersion : page.originalVersion,
    title: `${paper.value?.paperCode ?? '答卷'} · 第 ${index + 1} 页`,
    caption: page.scannedPath ? '扫描答卷与批阅区域' : '原始答卷（扫描件缺失）',
    regions:
      result.value?.modelResult.questionRegions
        ?.filter((region) => region.pageIndex === index)
        .map((region) => ({
          ...region,
          score: scoreMap.get(region.questionId)?.score ?? null,
          maxScore: scoreMap.get(region.questionId)?.maxScore ?? null,
        })) ?? [],
  }));
});

function formatScoreValue(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatScoreBreakdownBadge(point: ScoreBreakdownItem): string {
  return `${formatScoreValue(point.score)}/${formatScoreValue(point.maxScore)}`;
}

function getScoreBreakdownBadgeClass(point: ScoreBreakdownItem): string {
  const epsilon = 0.001;

  if (point.maxScore > 0 && Math.abs(point.score - point.maxScore) <= epsilon) {
    return 'score-breakdown-badge--full';
  }

  if (point.score <= epsilon) {
    return 'score-breakdown-badge--zero';
  }

  return 'score-breakdown-badge--partial';
}

async function loadPrintData(targetProjectId: string, targetPaperId: string) {
  const detail = await window.neuromark.projects.getDetail(targetProjectId);
  projectName.value = detail.project.name;
  latestReferenceAnswerVersion.value = detail.project.referenceAnswerVersion;
  paper.value =
    detail.originals.find((item) => item.id === targetPaperId) ?? null;
  const matchedResult = detail.results.find(
    (item) => item.paperId === targetPaperId,
  );

  if (!paper.value || !matchedResult?.finalResult || !matchedResult.modelResult) {
    throw new Error('未找到可导出的批阅结果。');
  }

  result.value = matchedResult as ResultRecord & {
    finalResult: FinalResult;
    modelResult: NonNullable<ResultRecord['modelResult']>;
  };
}

async function waitForImagesReady() {
  await nextTick();
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'));
  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve, reject) => {
          if (image.complete && image.naturalWidth > 0) {
            resolve();
            return;
          }

          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener(
            'error',
            () => reject(new Error(`图片加载失败：${image.alt || image.src}`)),
            { once: true },
          );
        }),
    ),
  );
}

async function waitForPrintReady() {
  await nextTick();
  await waitForImagesReady();

  if ('fonts' in document) {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  }

  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

async function notifyReady(targetToken: string) {
  if (!targetToken) {
    return;
  }
  await window.neuromark.app.notifyResultPdfPrintReady(targetToken);
}

async function notifyFailed(targetToken: string, error: unknown) {
  const message = error instanceof Error ? error.message : '批阅结果打印页渲染失败。';
  errorMessage.value = message;
  if (!targetToken) {
    return;
  }
  await window.neuromark.app.notifyResultPdfPrintFailed(targetToken, message);
}

watch(
  () => [projectId.value, paperId.value, token.value] as const,
  async ([nextProjectId, nextPaperId, nextToken]) => {
    if (!nextProjectId || !nextPaperId || !nextToken) {
      return;
    }

    const currentSequence = renderSequence + 1;
    renderSequence = currentSequence;
    projectName.value = '';
    paper.value = null;
    result.value = null;
    errorMessage.value = '';

    try {
      await loadPrintData(nextProjectId, nextPaperId);
      if (currentSequence !== renderSequence) {
        return;
      }
      await waitForPrintReady();
      if (currentSequence !== renderSequence) {
        return;
      }
      await notifyReady(nextToken);
    } catch (error) {
      if (currentSequence !== renderSequence) {
        return;
      }
      await notifyFailed(nextToken, error);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="page-stack page-stack--result-print result-pdf-print-page">
    <section
      v-if="paper && result && finalResult"
      class="result-workspace result-workspace--print-mode"
    >
      <div class="result-workspace-scroll">
        <div class="result-workspace-stack">
          <div class="result-subsection-card result-subsection-card--allow-overflow">
            <div class="result-panel-head">
              <div>
                <div class="result-section-title">扫描答卷与答题区域</div>
                <div class="detail-subtitle">{{ projectName }}</div>
              </div>
            </div>

            <div class="result-stage-stack result-stage-stack--embedded">
              <div
                v-for="image in previewImages"
                :key="image.title"
                class="stage-card"
              >
                <div class="stage-card-title">{{ image.title }}</div>
                <div class="paper-stage paper-stage--thumbnail">
                  <img
                    class="paper-stage-image"
                    :src="toImageSrc(image.src, image.cacheKey)"
                    :alt="image.title"
                  >
                  <div
                    v-for="region in image.regions ?? []"
                    :key="`${image.title}-${region.questionId}`"
                    class="paper-stage-region"
                    :style="{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                    }"
                  >
                    <span>{{ region.questionId }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="result-paper-summary">
            <div class="result-paper-title">{{ paper.paperCode }}</div>
            <div class="result-paper-meta">
              {{ finalResult.studentInfo.name || '未识别姓名' }}
              <span>学号 {{ finalResult.studentInfo.studentId || '未识别' }}</span>
              <span>班级 {{ finalResult.studentInfo.className || '未识别' }}</span>
              <span>最终总分 {{ displayedTotal }}</span>
            </div>
          </div>

          <div
            v-if="!selectedResultUsesLatestReference"
            class="result-version-alert"
          >
            当前结果基于参考答案 v{{ result.referenceAnswerVersion }} 批阅，项目最新版本为
            v{{ latestReferenceAnswerVersion }}。
          </div>
          <div v-else class="result-version-row">
            <span class="detail-subtitle">
              参考答案 v{{ result.referenceAnswerVersion }}
            </span>
          </div>

          <div class="result-subsection-card">
            <div class="result-panel-head">
              <div>
                <div class="result-section-title">基础信息与总分</div>
              </div>
            </div>
            <div class="result-score-summary-grid">
              <div class="result-score-summary-card">
                <span>最终总分</span>
                <strong>{{ displayedTotal }}</strong>
              </div>
              <div class="result-score-summary-card">
                <span>模型原始总分</span>
                <strong>{{ finalResult.totalScore }}</strong>
              </div>
            </div>
          </div>

          <div class="result-subsection-card">
            <div class="result-panel-head">
              <div>
                <div class="result-section-title">小题逐项核对</div>
              </div>
            </div>

            <div class="question-list">
              <div
                v-for="question in finalResult.questionScores"
                :key="question.questionId"
                class="question-card"
              >
                <div class="question-card-head">
                  <div>
                    <div class="question-card-title question-card-title--markdown">
                      <span class="question-card-title-prefix">
                        {{ question.questionId }} ·
                      </span>
                      <MarkdownRenderer
                        class="question-card-title-content"
                        :source="question.questionTitle"
                      />
                    </div>
                    <div class="question-card-meta">
                      满分 {{ question.maxScore }}
                    </div>
                  </div>
                  <div class="question-card-actions">
                    <div class="question-score-pill">
                      当前得分 {{ formatScoreValue(question.score) }}/{{
                        formatScoreValue(question.maxScore)
                      }}
                    </div>
                  </div>
                </div>
                <div v-if="question.issues.length" class="issues-box">
                  <strong>问题点</strong>
                  <ul>
                    <li v-for="issue in question.issues" :key="issue">
                      <MarkdownRenderer :source="issue" />
                    </li>
                  </ul>
                </div>
                <div class="question-card-expanded">
                  <MarkdownRenderer :source="question.reasoning" />
                  <div
                    v-if="question.scoreBreakdown.length"
                    class="issues-box"
                  >
                    <strong>采分明细</strong>
                    <ul class="score-breakdown-list">
                      <li
                        v-for="point in question.scoreBreakdown"
                        :key="`${question.questionId}-${point.criterionId}`"
                      >
                        <div class="score-breakdown-head">
                          <span class="score-breakdown-criterion-id">
                            {{ point.criterionId }} ·
                          </span>
                          <span
                            class="score-breakdown-badge"
                            :class="getScoreBreakdownBadgeClass(point)"
                          >
                            {{ formatScoreBreakdownBadge(point) }}
                          </span>
                        </div>
                        <div class="score-breakdown-line">
                          <span class="score-breakdown-logo score-breakdown-logo--standard">
                            标准
                          </span>
                          <MarkdownRenderer :source="point.criterion" />
                        </div>
                        <div class="score-breakdown-line">
                          <span class="score-breakdown-logo score-breakdown-logo--evidence">
                            判定
                          </span>
                          <MarkdownRenderer :source="point.evidence" />
                        </div>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div class="result-subsection-card">
            <div class="result-panel-head">
              <div>
                <div class="result-section-title">整卷建议</div>
              </div>
            </div>

            <div class="question-list">
              <div class="question-card question-card--advice">
                <div class="question-card-title">总体判断</div>
                <MarkdownRenderer :source="finalResult.overallAdvice.summary" />
              </div>

              <div class="question-card question-card--advice">
                <div class="question-card-title">表现较好的方面</div>
                <div
                  v-if="finalResult.overallAdvice.strengths.length"
                  class="issues-box"
                >
                  <ul>
                    <li
                      v-for="item in finalResult.overallAdvice.strengths"
                      :key="item"
                    >
                      <MarkdownRenderer :source="item" />
                    </li>
                  </ul>
                </div>
                <div v-else class="detail-subtitle">
                  暂无特别突出的优势总结。
                </div>
              </div>

              <div class="question-card question-card--advice">
                <div class="question-card-title">优先补强知识点</div>
                <div
                  v-if="finalResult.overallAdvice.priorityKnowledgePoints.length"
                  class="issues-box"
                >
                  <ul>
                    <li
                      v-for="item in finalResult.overallAdvice
                        .priorityKnowledgePoints"
                      :key="item"
                    >
                      <MarkdownRenderer :source="item" />
                    </li>
                  </ul>
                </div>
                <div v-else class="detail-subtitle">
                  当前没有明确需要优先补强的知识点。
                </div>
              </div>

              <div class="question-card question-card--advice">
                <div class="question-card-title">答题注意事项</div>
                <div
                  v-if="finalResult.overallAdvice.attentionPoints.length"
                  class="issues-box"
                >
                  <ul>
                    <li
                      v-for="item in finalResult.overallAdvice.attentionPoints"
                      :key="item"
                    >
                      <MarkdownRenderer :source="item" />
                    </li>
                  </ul>
                </div>
                <div v-else class="detail-subtitle">
                  当前没有额外的答题习惯提醒。
                </div>
              </div>

              <div class="question-card question-card--advice">
                <div class="question-card-title">鼓励与提醒</div>
                <MarkdownRenderer
                  :source="finalResult.overallAdvice.encouragement"
                />
              </div>
            </div>
          </div>

          <div class="result-subsection-card">
            <div class="result-panel-head">
              <div>
                <div class="result-section-title">整体评语</div>
              </div>
            </div>
            <MarkdownRenderer :source="finalResult.overallComment" />
          </div>
        </div>
      </div>
    </section>

    <div v-else class="result-pdf-print-page__loading">
      {{ errorMessage || '正在准备批阅结果 PDF...' }}
    </div>
  </div>
</template>
