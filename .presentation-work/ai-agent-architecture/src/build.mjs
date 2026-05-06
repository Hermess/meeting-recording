import fs from "node:fs/promises";
import path from "node:path";
import {
  Presentation,
  PresentationFile,
  fill,
  fixed,
  hug,
  panel,
  shape,
  text,
  drawSlideToCtx,
} from "@oai/artifact-tool";
import { Canvas } from "skia-canvas";

const SLIDE = { width: 1920, height: 1080 };
const workspace = path.resolve(".");
const outputDir = path.join(workspace, "output");
const scratchDir = path.join(workspace, "scratch");
const finalPptx = path.join(outputDir, "output.pptx");
const mirroredPptx = "/Users/caifeiya/Documents/智能会议/AI智能体平台架构图.pptx";
const previewPng = path.join(scratchDir, "architecture-preview.png");

const C = {
  white: "#FFFFFF",
  pale: "#DCE8FA",
  paleLight: "#EAF2FF",
  blue: "#0A58DB",
  line: "#0A58DB",
  block: "#3B78CF",
  blockDark: "#2F68B5",
};

const FONT = "PingFang SC";
const presentation = Presentation.create({ slideSize: SLIDE });
const slide = presentation.slides.add();
slide.background.fill = C.white;

function font(size, color = C.blue, extra = {}) {
  return { fontFamily: FONT, fontSize: size, color, ...extra };
}

function compose(node, frame) {
  slide.compose(node, { frame, baseUnit: 8 });
}

function addText(value, x, y, w, h, opts = {}) {
  compose(
    text(value, {
      name: opts.name,
      width: fill,
      height: opts.fillHeight ? fill : hug,
      style: font(opts.size ?? 22, opts.color ?? C.blue, {
        bold: opts.bold,
        alignment: opts.align,
        verticalAlignment: opts.verticalAlignment,
        lineSpacingMultiple: opts.lineSpacingMultiple ?? 1,
      }),
    }),
    { left: x, top: y, width: w, height: h },
  );
}

function addRect(x, y, w, h, opts = {}) {
  compose(
    shape({
      name: opts.name,
      width: fill,
      height: fill,
      fill: opts.fill ?? C.pale,
      line: { color: opts.line ?? C.line, width: opts.lineWidth ?? 2 },
    }),
    { left: x, top: y, width: w, height: h },
  );
}

function addModule(label, x, y, w, h, opts = {}) {
  compose(
    panel(
      {
        name: opts.name ?? `module-${label}`,
        width: fill,
        height: fill,
        fill: opts.fill ?? C.block,
        line: { color: opts.line ?? "#174FA8", width: opts.lineWidth ?? 2 },
        padding: { x: 8, y: 5 },
        align: "center",
        justify: "center",
      },
      text(label, {
        name: `${opts.name ?? `module-${label}`}-text`,
        width: fill,
        height: fill,
        style: font(opts.size ?? 22, opts.color ?? C.white, {
          bold: true,
          alignment: "center",
          verticalAlignment: "middle",
          lineSpacingMultiple: 0.96,
        }),
      }),
    ),
    { left: x, top: y, width: w, height: h },
  );
}

function addLayerTitle(label, x, y, w, opts = {}) {
  addText(label, x, y, w, 28, {
    name: `title-${label}`,
    size: opts.size ?? 25,
    color: C.blue,
    bold: true,
    align: "center",
  });
}

function addLayerFrame(label, x, y, w, h, opts = {}) {
  addRect(x, y, w, h, { name: `frame-${label}`, fill: C.pale, line: C.line, lineWidth: 2 });
  addLayerTitle(label, x, y + (opts.titleTop ?? 10), w, { size: opts.titleSize });
}

function addArrow(x, y, name) {
  addText("↓", x - 18, y, 36, 28, {
    name,
    size: 22,
    color: C.blue,
    bold: true,
    align: "center",
  });
}

function addVerticalRail(label, x, y, w, h, opts = {}) {
  addRect(x, y, w, h, {
    name: opts.name ?? `rail-${label}`,
    fill: C.block,
    line: "#174FA8",
    lineWidth: 2,
  });
  addText(label.split("").join("\n"), x + 18, y + h / 2 - 92, w - 36, 184, {
    name: `${opts.name ?? `rail-${label}`}-text`,
    size: 27,
    color: C.white,
    bold: true,
    align: "center",
    lineSpacingMultiple: 0.92,
  });
}

function addGovernanceList(x, y, w, h) {
  addRect(x, y, w, h, { name: "governance-list-rail", fill: C.pale, line: C.line, lineWidth: 2 });
  const items = ["安全保障", "身份权限", "标准规范", "审计追责", "生态合作", "成本治理"];
  const rowH = 50;
  items.forEach((item, i) => addModule(item, x + 20, y + 28 + i * rowH, w - 40, 34, { size: 16 }));
}

const centerX = 304;
const centerW = 1294;
const leftRailX = 182;
const railW = 72;
const rightRailX = 1648;
const rightRailW = 178;
const topY = 56;
const layerGap = 12;
const arrowX = centerX + centerW / 2;

// Decorative page cue only: the content remains the user's original architecture.
addRect(0, 0, 218, 96, { name: "blue-corner", fill: C.paleLight, line: C.paleLight, lineWidth: 0 });

let y = topY;

// 业务场景层
addLayerFrame("业务场景层", centerX, y, centerW, 88, { titleTop: 7 });
[
  ["场景1", centerX + 38, 268],
  ["场景2", centerX + 408, 268],
  ["...", centerX + 760, 70],
  ["场景n", centerX + 948, 268],
].forEach(([label, x, w]) => addModule(label, x, y + 38, w, 38, { size: 20 }));
y += 88;
addArrow(arrowX, y - 3, "arrow-business-app");
y += layerGap + 13;

// AI应用与交互层
addLayerFrame("AI应用与交互层", centerX, y, centerW, 92, { titleTop: 8 });
[
  ["数字人", centerX + 54, 150],
  ["Copilot", centerX + 236, 150],
  ["业务助手", centerX + 418, 150],
  ["API Agent", centerX + 600, 170],
  ["自动化工作流", centerX + 802, 212],
].forEach(([label, x, w]) => addModule(label, x, y + 40, w, 38, { size: label.length > 7 ? 18 : 20 }));
y += 92;
addArrow(arrowX, y - 3, "arrow-app-agent");
y += layerGap + 13;

// Agent运行与认知编排层
addLayerFrame("Agent运行与认知编排层", centerX, y, centerW, 142, { titleTop: 9 });
[
  ["意图识别", centerX + 46, y + 48, 134],
  ["任务规划", centerX + 216, y + 48, 134],
  ["记忆管理", centerX + 386, y + 48, 134],
  ["上下文管理", centerX + 556, y + 48, 154],
  ["工具路由", centerX + 746, y + 48, 134],
  ["行动执行", centerX + 916, y + 48, 134],
  ["结果校验", centerX + 1086, y + 48, 134],
  ["反馈学习", centerX + 556, y + 96, 154],
].forEach(([label, x, yy, w]) => addModule(label, x, yy, w, 34, { size: 18 }));
y += 142;

// ITS / DTS side-by-side platforms, exactly from original content.
const platformY = y + 22;
const platformH = 194;
const halfW = 630;
const platformGap = 34;
addText("↑", centerX + halfW / 2 - 18, y - 2, 36, 28, {
  name: "arrow-its-up",
  size: 22,
  color: C.blue,
  bold: true,
  align: "center",
});
addText("↓", centerX + halfW + platformGap + halfW / 2 - 18, y - 2, 36, 28, {
  name: "arrow-dts-down",
  size: 22,
  color: C.blue,
  bold: true,
  align: "center",
});

addLayerFrame("ITS 智能体开发治理平台", centerX, platformY, halfW, platformH, {
  titleTop: 8,
  titleSize: 22,
});
[
  ["知识库管理", centerX + 34, platformY + 46, 142],
  ["智能体开发", centerX + 200, platformY + 46, 142],
  ["Prompt / Skill / 工具配置", centerX + 366, platformY + 46, 220],
  ["评测体系", centerX + 34, platformY + 102, 142],
  ["安全审计", centerX + 200, platformY + 102, 142],
  ["发布 / 版本 / 运行观测", centerX + 366, platformY + 102, 220],
].forEach(([label, x, yy, w]) => addModule(label, x, yy, w, 38, { size: label.length > 12 ? 16 : 17 }));

const dtsX = centerX + halfW + platformGap;
addLayerFrame("DTS 数字技术服务底座", dtsX, platformY, halfW, platformH, {
  titleTop: 8,
  titleSize: 22,
});
[
  ["用户中心", dtsX + 34, platformY + 46, 136],
  ["元数据中心", dtsX + 196, platformY + 46, 136],
  ["模型网关", dtsX + 358, platformY + 46, 136],
  ["流程引擎", dtsX + 34, platformY + 102, 136],
  ["API网关 / 连接器", dtsX + 196, platformY + 102, 158],
  ["日志 / 监控 / 权限", dtsX + 380, platformY + 102, 178],
].forEach(([label, x, yy, w]) => addModule(label, x, yy, w, 38, { size: label.length > 9 ? 15 : 17 }));

y = platformY + platformH;
addArrow(arrowX, y - 1, "arrow-platform-knowledge");
y += layerGap + 10;

// 知识、语义与工具层
addLayerFrame("知识、语义与工具层", centerX, y, centerW, 126, { titleTop: 9 });
addModule("AI Wiki / 企业知识库 / 向量库 / 知识图谱 / 动态本体", centerX + 56, y + 48, centerW - 112, 34, {
  size: 17,
});
addModule("Skill / MCP工具 / API / RPA / 插件 / 业务系统连接器", centerX + 56, y + 88, centerW - 112, 30, {
  size: 16,
});
y += 126;
addArrow(arrowX, y - 3, "arrow-knowledge-model");
y += layerGap + 9;

// 模型与数据服务层
addLayerFrame("模型与数据服务层", centerX, y, centerW, 80, { titleTop: 8 });
addModule("MaaS / DaaS / Embedding / Reranker / 多模态 / ASR / TTS", centerX + 78, y + 38, centerW - 156, 32, {
  size: 17,
});
y += 80;
addArrow(arrowX, y - 4, "arrow-model-infra");
y += layerGap + 10;

// AI基础设施层
addLayerFrame("AI基础设施层", centerX, y, centerW, 80, { titleTop: 8 });
addModule("GPU / TPU / 存储 / 网络 / 推理服务 / 训练服务 / 云边端资源", centerX + 78, y + 38, centerW - 156, 32, {
  size: 17,
});

const railTop = platformY;
const railBottom = y + 80;
addVerticalRail("横切治理", leftRailX, railTop, railW, railBottom - railTop, { name: "cross-governance-rail" });
addGovernanceList(rightRailX, railTop, rightRailW, railBottom - railTop);

addText("横切治理：安全保障 / 身份权限 / 标准规范 / 审计追责 / 生态合作 / 成本治理。", centerX, 1018, centerW, 30, {
  name: "cross-governance-line",
  size: 18,
  color: C.blue,
  bold: true,
  align: "center",
});

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(scratchDir, { recursive: true });

const pptxBlob = await PresentationFile.exportPptx(presentation);
await pptxBlob.save(finalPptx);
await fs.copyFile(finalPptx, mirroredPptx);

const canvas = new Canvas(SLIDE.width, SLIDE.height);
const ctx = canvas.getContext("2d");
await drawSlideToCtx(slide, presentation, ctx, null, null, null, null, null, null, null, {
  clearBeforeDraw: true,
});
const png = await canvas.toBuffer("png");
await fs.writeFile(previewPng, png);

const report = {
  finalPptx,
  mirroredPptx,
  previewPng,
  slideCount: presentation.slides.items.length,
  note: "Single editable architecture slide using only the original supplied content, redrawn in the blue reference visual style.",
};
await fs.writeFile(path.join(scratchDir, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
