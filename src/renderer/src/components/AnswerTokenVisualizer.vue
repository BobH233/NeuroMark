<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useTokenVisualizerStore } from '@/stores/token-visualizer';

const props = withDefaults(defineProps<{
  fullscreen?: boolean;
}>(), {
  fullscreen: false,
});

interface TokenBlock {
  id: string;
  text: string;
  hasEnteredStage: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  width: number;
  height: number;
  textWidth: number;
  textHeight: number;
  textAscent: number;
  hue: number;
  glowHue: number;
  source: 'preview' | 'reasoning';
  createdAt: number;
  opacity: number;
  angle: number;
  angularVelocity: number;
  angularDamping: number;
  inertia: number;
  sprite: HTMLCanvasElement;
  spriteWidth: number;
  spriteHeight: number;
}

const visualizerStore = useTokenVisualizerStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const hostRef = ref<HTMLElement | null>(null);
const blockCount = ref(0);
const burstCount = ref(0);

let canvasContext: CanvasRenderingContext2D | null = null;
let animationFrame = 0;
let resizeObserver: ResizeObserver | null = null;
let backgroundLayer: HTMLCanvasElement | null = null;
let latestWidth = 0;
let latestHeight = 0;
let lastFrameAt = 0;
const blocks: TokenBlock[] = [];
const huePalette = [12, 38, 74, 144, 196, 228, 286, 328];
const COLLISION_PADDING = 6;
const FLOOR_PADDING = 52;
const WALL_PADDING = 26;
const BLOCK_LIFETIME_MS = 5000;
const FADE_DURATION_MS = 1400;
const BASE_FONT = '800 28px "PingFang SC", "Noto Sans SC", sans-serif';
const MAX_EMIT_PER_SECOND = 10;
let emitBudget = MAX_EMIT_PER_SECOND;

const statusText = computed(() =>
  burstCount.value > 0
    ? `词块 ${blockCount.value} 个 · 已接住 ${burstCount.value} 次流式片段`
    : '等待新的 token 落入词池',
);

function resizeCanvas() {
  const canvas = canvasRef.value;
  const host = hostRef.value;
  if (!canvas || !host) {
    return;
  }

  const bounds = host.getBoundingClientRect();
  const width = Math.max(320, Math.floor(bounds.width));
  const height = Math.max(420, Math.floor(bounds.height));
  const ratio = window.devicePixelRatio || 1;

  latestWidth = width;
  latestHeight = height;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  canvasContext = canvas.getContext('2d');
  if (!canvasContext) {
    return;
  }

  canvasContext.setTransform(1, 0, 0, 1, 0, 0);
  canvasContext.scale(ratio, ratio);
  rebuildBackgroundLayer();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createBlockSprite(block: {
  text: string;
  textWidth: number;
  textHeight: number;
  textAscent: number;
  hue: number;
  glowHue: number;
}) {
  const glowPadding = 30;
  const canvas = document.createElement('canvas');
  const width = Math.ceil(block.textWidth + glowPadding * 2);
  const height = Math.ceil(block.textHeight + glowPadding * 2 + 16);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    return {
      canvas,
      width,
      height,
    };
  }

  context.textBaseline = 'alphabetic';
  context.textAlign = 'center';
  context.font = BASE_FONT;
  context.translate(width * 0.5, height * 0.5);

  const fillGradient = context.createLinearGradient(
    -block.textWidth * 0.5,
    -block.textHeight * 0.5,
    block.textWidth * 0.5,
    block.textHeight * 0.5,
  );
  fillGradient.addColorStop(0, `hsla(${block.hue}, 94%, 68%, 0.98)`);
  fillGradient.addColorStop(1, `hsla(${block.glowHue}, 94%, 62%, 0.98)`);

  context.shadowColor = `hsla(${block.glowHue}, 98%, 66%, 0.5)`;
  context.shadowBlur = 20;
  context.shadowOffsetY = 8;
  context.lineWidth = 1.2;
  context.strokeStyle = 'rgba(255,255,255,0.32)';
  context.strokeText(block.text, 0, block.textAscent * 0.38);
  context.fillStyle = fillGradient;
  context.fillText(block.text, 0, block.textAscent * 0.38);

  return {
    canvas,
    width,
    height,
  };
}

function createBlock(text: string, source: 'preview' | 'reasoning'): TokenBlock | null {
  if (!canvasContext || latestWidth <= 0 || latestHeight <= 0) {
    return null;
  }

  canvasContext.font = BASE_FONT;
  const metrics = canvasContext.measureText(text);
  const textWidth = clamp(metrics.width, 12, 220);
  const textAscent = Math.max(18, metrics.actualBoundingBoxAscent || 22);
  const textDescent = Math.max(6, metrics.actualBoundingBoxDescent || 8);
  const textHeight = textAscent + textDescent;
  const width = textWidth + COLLISION_PADDING * 2;
  const height = textHeight + COLLISION_PADDING * 2;
  const spawnEdge = Math.random() < 0.5 ? 'left' : 'right';
  let spawnState: { x: number; y: number; vx: number; vy: number };

  if (spawnEdge === 'left') {
    spawnState = {
      x: -width * 0.9,
      y: latestHeight * (0.68 + Math.random() * 0.12),
      vx: 10 + Math.random() * 4.6,
      vy: -(12 + Math.random() * 2.6),
    };
  } else {
    spawnState = {
      x: latestWidth + width * 0.9,
      y: latestHeight * (0.68 + Math.random() * 0.12),
      vx: -(10 + Math.random() * 4.6),
      vy: -(12 + Math.random() * 2.6),
    };
  }

  const hue = huePalette[Math.floor(Math.random() * huePalette.length)];
  const inertia = Math.max(0.78, Math.min(1.55, width / Math.max(height, 1)));
  const angularVelocity = ((Math.random() - 0.5) * 0.1) + (spawnState.vx * 0.005);
  const glowHue = (hue + 28 + Math.random() * 44) % 360;
  const renderedSprite = createBlockSprite({
    text,
    textWidth,
    textHeight,
    textAscent,
    hue,
    glowHue,
  });
  const offscreenPadding = 156;
  const horizontalSpawnOffset = renderedSprite.width * (1.12 + Math.random() * 0.24) + offscreenPadding;

  return {
    id: `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    hasEnteredStage: false,
    x: spawnEdge === 'left'
      ? -horizontalSpawnOffset
      : latestWidth + horizontalSpawnOffset,
    y: spawnState.y,
    vx: spawnState.vx,
    vy: spawnState.vy,
    width,
    height,
    textWidth,
    textHeight,
    textAscent,
    hue,
    glowHue,
    source,
    createdAt: Date.now(),
    opacity: 1,
    angle: (Math.random() - 0.5) * 0.38,
    angularVelocity,
    angularDamping: 0.985 + Math.random() * 0.01,
    inertia,
    sprite: renderedSprite.canvas,
    spriteWidth: renderedSprite.width,
    spriteHeight: renderedSprite.height,
  };
}

function spawnPendingBlocks() {
  const emitCount = Math.min(
    Math.floor(emitBudget),
    visualizerStore.getPendingCount(),
  );

  if (emitCount <= 0) {
    return;
  }

  const bursts = visualizerStore.drainPending(emitCount);
  emitBudget -= bursts.length;
  burstCount.value += bursts.length;

  for (const burst of bursts) {
    const block = createBlock(burst.text, burst.source);
    if (!block) {
      continue;
    }
    blocks.push(block);
  }

  const keepCount = Math.ceil(emitBudget);
  visualizerStore.trimPending(keepCount);
}

function updateBlocks(deltaSeconds: number) {
  const frameScale = deltaSeconds * 60;
  const floorY = latestHeight - FLOOR_PADDING;
  const leftWall = WALL_PADDING;
  const rightWall = latestWidth - WALL_PADDING;

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    const ageMs = Date.now() - block.createdAt;
    block.vy += 0.22 * frameScale;
    block.vx *= 0.997;
    block.vy *= 0.999;
    block.angularVelocity *= block.angularDamping;

    block.x += block.vx * frameScale;
    block.y += block.vy * frameScale;
    block.angle += block.angularVelocity * frameScale;

    const halfWidth = block.width * 0.5;
    const halfHeight = block.height * 0.5;
    const hasEnteredVisibleStage =
      block.x - halfWidth >= leftWall && block.x + halfWidth <= rightWall;

    if (!block.hasEnteredStage && hasEnteredVisibleStage) {
      block.hasEnteredStage = true;
    }

    if (block.hasEnteredStage && block.x - halfWidth < leftWall) {
      block.x = leftWall + halfWidth;
      block.vx = Math.abs(block.vx) * 0.82;
    }

    if (block.hasEnteredStage && block.x + halfWidth > rightWall) {
      block.x = rightWall - halfWidth;
      block.vx = -Math.abs(block.vx) * 0.82;
    }

    if (block.y + halfHeight > floorY) {
      block.y = floorY - halfHeight;
      block.vy = -Math.abs(block.vy) * 0.48;
      block.vx *= 0.992;

      if (Math.abs(block.vy) < 0.18) {
        block.vy = 0;
      }
      if (Math.abs(block.angularVelocity) < 0.0008) {
        block.angularVelocity = 0;
      }
    }

    if (block.y - halfHeight > latestHeight + 120) {
      blocks.splice(index, 1);
      continue;
    }

    const fadeStartAt = BLOCK_LIFETIME_MS - FADE_DURATION_MS;
    const shouldFadeForAge = ageMs > fadeStartAt;

    if (shouldFadeForAge) {
      const fadeProgress = clamp((ageMs - fadeStartAt) / FADE_DURATION_MS, 0, 1);
      block.opacity = 1 - fadeProgress;
    } else {
      block.opacity = 1;
    }

    if (ageMs >= BLOCK_LIFETIME_MS || block.opacity <= 0.02) {
      blocks.splice(index, 1);
    }
  }

  blockCount.value = blocks.length;
}

function paintBackgroundLayer(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  context.clearRect(0, 0, width, height);

  const backgroundGradient = context.createLinearGradient(0, 0, width, height);
  backgroundGradient.addColorStop(0, '#04131d');
  backgroundGradient.addColorStop(0.4, '#0f2740');
  backgroundGradient.addColorStop(1, '#091018');
  context.fillStyle = backgroundGradient;
  context.fillRect(0, 0, width, height);

  const spotlight = context.createRadialGradient(
    width * 0.5,
    height * 0.18,
    30,
    width * 0.5,
    height * 0.18,
    width * 0.62,
  );
  spotlight.addColorStop(0, 'rgba(255,255,255,0.16)');
  spotlight.addColorStop(0.35, 'rgba(67,225,255,0.12)');
  spotlight.addColorStop(1, 'rgba(4,19,29,0)');
  context.fillStyle = spotlight;
  context.fillRect(0, 0, width, height);

  for (let index = 0; index < 12; index += 1) {
    const x = (index / 11) * width;
    context.strokeStyle = `rgba(85, 226, 255, ${index % 2 === 0 ? 0.07 : 0.04})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x - width * 0.15, height);
    context.stroke();
  }

  const poolGradient = context.createLinearGradient(0, height - 180, 0, height);
  poolGradient.addColorStop(0, 'rgba(16, 132, 184, 0)');
  poolGradient.addColorStop(0.45, 'rgba(11, 214, 245, 0.14)');
  poolGradient.addColorStop(1, 'rgba(255, 130, 78, 0.18)');
  context.fillStyle = poolGradient;
  context.beginPath();
  context.moveTo(24, height - 108);
  context.quadraticCurveTo(width * 0.5, height - 16, width - 24, height - 108);
  context.lineTo(width - 24, height);
  context.lineTo(24, height);
  context.closePath();
  context.fill();

  context.strokeStyle = 'rgba(132, 245, 255, 0.35)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(24, height - 108);
  context.quadraticCurveTo(width * 0.5, height - 16, width - 24, height - 108);
  context.stroke();
}

function rebuildBackgroundLayer() {
  if (latestWidth <= 0 || latestHeight <= 0) {
    backgroundLayer = null;
    return;
  }

  const nextLayer = document.createElement('canvas');
  nextLayer.width = latestWidth;
  nextLayer.height = latestHeight;
  const context = nextLayer.getContext('2d');
  if (!context) {
    backgroundLayer = null;
    return;
  }

  paintBackgroundLayer(context, latestWidth, latestHeight);
  backgroundLayer = nextLayer;
}

function drawBackground(context: CanvasRenderingContext2D) {
  if (!backgroundLayer) {
    rebuildBackgroundLayer();
  }

  context.clearRect(0, 0, latestWidth, latestHeight);
  if (!backgroundLayer) {
    return;
  }

  context.drawImage(backgroundLayer, 0, 0, latestWidth, latestHeight);
}

function drawBlocks(context: CanvasRenderingContext2D) {
  for (const block of blocks) {
    context.save();
    context.translate(block.x, block.y);
    context.rotate(block.angle);
    context.globalAlpha = block.opacity;
    context.drawImage(
      block.sprite,
      -block.spriteWidth * 0.5,
      -block.spriteHeight * 0.5,
      block.spriteWidth,
      block.spriteHeight,
    );

    context.restore();
  }
}

function drawHud(context: CanvasRenderingContext2D) {
  context.save();
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = 'rgba(255, 255, 255, 0.82)';
  context.font = '700 15px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText('Token Playground', 34, 40);
  context.fillStyle = 'rgba(181, 220, 235, 0.86)';
  context.font = '500 13px "PingFang SC", "Noto Sans SC", sans-serif';
  context.fillText(statusText.value, 34, 64);
  context.restore();
}

function renderFrame(frameAt: number) {
  animationFrame = window.requestAnimationFrame(renderFrame);

  if (!canvasContext) {
    return;
  }

  if (!lastFrameAt) {
    lastFrameAt = frameAt;
  }

  const deltaSeconds = clamp((frameAt - lastFrameAt) / 1000, 1 / 120, 1 / 24);
  lastFrameAt = frameAt;
  emitBudget = Math.min(MAX_EMIT_PER_SECOND, emitBudget + deltaSeconds * MAX_EMIT_PER_SECOND);

  spawnPendingBlocks();
  updateBlocks(deltaSeconds);
  drawBackground(canvasContext);
  drawBlocks(canvasContext);
  drawHud(canvasContext);
}

onMounted(() => {
  resizeCanvas();
  if (hostRef.value) {
    resizeObserver = new ResizeObserver(() => {
      resizeCanvas();
    });
    resizeObserver.observe(hostRef.value);
  }
  animationFrame = window.requestAnimationFrame(renderFrame);
});

onUnmounted(() => {
  if (animationFrame) {
    window.cancelAnimationFrame(animationFrame);
  }
  resizeObserver?.disconnect();
});
</script>

<template>
  <section
    ref="hostRef"
    class="token-visualizer"
    :class="{ 'token-visualizer--fullscreen': props.fullscreen }"
  >
    <canvas
      ref="canvasRef"
      class="token-visualizer-canvas"
    />
  </section>
</template>

<style scoped>
.token-visualizer {
  position: relative;
  min-height: calc(100dvh - 210px);
  border-radius: 30px;
  overflow: hidden;
  border: 1px solid rgba(90, 209, 255, 0.18);
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.05),
    0 28px 70px rgba(8, 24, 39, 0.28);
}

.token-visualizer--fullscreen {
  min-height: calc(100dvh - 156px);
  height: calc(100dvh - 156px);
  border-radius: 34px;
}

.token-visualizer-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

@media (max-width: 900px) {
  .token-visualizer {
    min-height: calc(100dvh - 236px);
  }
}
</style>
