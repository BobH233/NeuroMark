import path from 'node:path';
import fs from 'fs-extra';

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export async function ensureMockPaperSvg(
  targetPath: string,
  title: string,
  subtitle: string,
  accent: string,
): Promise<void> {
  if (await fs.pathExists(targetPath)) {
    return;
  }

  const markup = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="1754" viewBox="0 0 1240 1754">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fbfdff"/>
      <stop offset="100%" stop-color="#f3f8ff"/>
    </linearGradient>
  </defs>
  <rect width="1240" height="1754" fill="#d8e2ee"/>
  <rect x="88" y="64" width="1064" height="1626" rx="30" fill="url(#bg)"/>
  <rect x="88" y="64" width="1064" height="1626" rx="30" fill="none" stroke="#9db5ca" stroke-width="6"/>
  <rect x="136" y="118" width="968" height="90" rx="20" fill="${accent}" opacity="0.12"/>
  <text x="160" y="178" font-size="42" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#12344d">${escapeXml(
    title,
  )}</text>
  <text x="160" y="226" font-size="26" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#4d6b82">${escapeXml(
    subtitle,
  )}</text>
  <g fill="#d5dfeb">
    <rect x="160" y="310" width="480" height="24" rx="12"/>
    <rect x="160" y="362" width="850" height="20" rx="10"/>
    <rect x="160" y="406" width="820" height="20" rx="10"/>
    <rect x="160" y="450" width="860" height="20" rx="10"/>
    <rect x="160" y="570" width="420" height="24" rx="12"/>
    <rect x="160" y="622" width="850" height="20" rx="10"/>
    <rect x="160" y="666" width="800" height="20" rx="10"/>
    <rect x="160" y="710" width="860" height="20" rx="10"/>
    <rect x="160" y="830" width="520" height="24" rx="12"/>
    <rect x="160" y="882" width="850" height="20" rx="10"/>
    <rect x="160" y="926" width="770" height="20" rx="10"/>
    <rect x="160" y="970" width="860" height="20" rx="10"/>
  </g>
  <rect x="740" y="1248" width="290" height="260" rx="26" fill="${accent}" opacity="0.12"/>
  <text x="785" y="1354" font-size="34" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#14536d">学生答卷示意</text>
  <text x="785" y="1410" font-size="26" font-family="PingFang SC, Microsoft YaHei, sans-serif" fill="#14536d">支持预览、放大与区域查看</text>
</svg>`;

  await fs.ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, markup, 'utf-8');
}
