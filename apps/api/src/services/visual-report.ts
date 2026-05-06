import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";
import { ProjectBiweeklyVisualReport } from "@meeting-ai-kit/visual-renderer";
import { resolveStoragePath } from "../utils/paths.js";

export type RenderVisualReportParams = {
  meetingId: string;
  templateId: string;
  width: number;
  scale: number;
  structuredJson: MeetingMinutesJson;
};

export type RenderVisualReportResult = {
  imagePath: string;
  imageUrl: string;
  renderUrl: string;
};

export async function renderVisualReportScreenshot(params: RenderVisualReportParams): Promise<RenderVisualReportResult> {
  const configuredScreenshotDir = process.env.VISUAL_REPORT_SCREENSHOT_DIR;
  const screenshotDir = configuredScreenshotDir
    ? path.resolve(configuredScreenshotDir)
    : resolveStoragePath("screenshots");
  const apiPublicBaseUrl = process.env.API_PUBLIC_BASE_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
  const renderUrl = `inline://visual-report/${params.meetingId}/${params.templateId}`;
  const imageFileName = `${params.meetingId}-${Date.now()}.png`;
  const imagePath = path.join(screenshotDir, imageFileName);
  const html = renderVisualReportHtml(params.structuredJson);

  await mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: Math.max(params.width + 480, 1500),
        height: 1600
      },
      deviceScaleFactor: params.scale
    });

    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });

    const report = page.locator("[data-visual-report]").first();
    await report.waitFor({
      state: "visible",
      timeout: 3000
    });

    await report.screenshot({
      path: imagePath,
      animations: "disabled"
    });
  } finally {
    await browser.close();
  }

  return {
    imagePath,
    imageUrl: `${apiPublicBaseUrl.replace(/\/$/, "")}/storage/screenshots/${imageFileName}`,
    renderUrl
  };
}

function renderVisualReportHtml(data: MeetingMinutesJson) {
  const body = renderToStaticMarkup(ProjectBiweeklyVisualReport({ data }));
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #ffffff; }
      body { width: max-content; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}
