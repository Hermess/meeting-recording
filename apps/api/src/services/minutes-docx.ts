import { existsSync, readFileSync } from "node:fs";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertInchesToTwip
} from "docx";
import type { ISectionOptions } from "docx";
import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";

export type RenderMinutesDocxParams = {
  title: string;
  minutes: MeetingMinutesJson;
  visualImagePath?: string;
};

const FONT = "Microsoft YaHei";
const FONT_EAST_ASIA = "Microsoft YaHei";
const PAGE_WIDTH_TWIP = 11906;
const PAGE_MARGIN_TWIP = convertInchesToTwip(0.82);
const CONTENT_WIDTH_TWIP = PAGE_WIDTH_TWIP - PAGE_MARGIN_TWIP * 2;

export async function renderMinutesDocx(params: RenderMinutesDocxParams) {
  const visualImage = loadVisualImage(params.visualImagePath);
  const milestoneBlocks = milestoneCards(params.minutes);
  const riskBlocks = riskCards(params.minutes);
  const actionBlock = actionTable(params.minutes);
  const coreConsensusBlock = isMeaningful(params.minutes.visual_summary.core_consensus)
    ? callout(params.minutes.visual_summary.core_consensus, "EAF7EF", "2F855A")
    : null;
  const moduleBlocks = moduleProgress(params.minutes);
  const decisionBlocks = numbered(params.minutes.decisions.filter((item) => isMeaningful(item.decision)).map((item) => `${item.decision}（${item.type}）`));
  const insightBlocks = insightCards(params.minutes);
  const todoBlocks = todoItems(params.minutes);
  const chapterBlocks = chapterTimeline(params.minutes);
  const children = compact([
    title(`纪要_${params.title}`),
    spacer(8),
    heading("纪要"),
    ...metaBlock(params.minutes),
    ...(visualImage ? [spacer(14), visualImageBlock(visualImage)] : []),
    spacer(22),
    heading("会议背景"),
    paragraph(params.minutes.executive_summary.summary_paragraph),
    ...(milestoneBlocks.length > 0 ? [heading("核心里程碑"), ...milestoneBlocks] : []),
    ...(riskBlocks.length > 0 ? [heading("核心风险与阻塞"), ...riskBlocks] : []),
    ...(actionBlock ? [heading("关键行动项"), actionBlock] : []),
    ...(coreConsensusBlock ? [heading("核心共识"), coreConsensusBlock] : []),
    ...(moduleBlocks.length > 0 ? [heading("模块进展"), ...moduleBlocks] : []),
    ...(decisionBlocks.length > 0 ? [heading("关键决策与共识"), ...decisionBlocks] : []),
    ...(insightBlocks.length > 0 ? [heading("AI 洞察"), ...insightBlocks] : []),
    ...(todoBlocks.length > 0 ? [heading("待办"), ...todoBlocks] : []),
    ...(chapterBlocks.length > 0 ? [heading("章节时间轴"), ...chapterBlocks] : [])
  ]);

  const section: ISectionOptions = {
    properties: {
      page: {
        margin: {
          top: PAGE_MARGIN_TWIP,
          right: PAGE_MARGIN_TWIP,
          bottom: PAGE_MARGIN_TWIP,
          left: PAGE_MARGIN_TWIP
        }
      }
    },
    children
  };

  const doc = new Document({
    creator: "AI 会议纪要视觉报告生成器",
    title: params.title,
    styles: {
      default: {
        document: {
          run: {
            font: FONT,
            size: 21
          },
          paragraph: {
            spacing: { line: 320, before: 0, after: 120 }
          }
        }
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: FONT,
            size: 40,
            bold: true,
            color: "1F2937"
          },
          paragraph: {
            spacing: { before: 0, after: 620 },
            keepNext: true
          }
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: FONT,
            size: 30,
            bold: true,
            color: "1F2937"
          },
          paragraph: {
            spacing: { before: 480, after: 220 },
            keepNext: true
          }
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: FONT,
            size: 24,
            bold: true,
            color: "374151"
          },
          paragraph: {
            spacing: { before: 240, after: 120 },
            keepNext: true
          }
        }
      ]
    },
    sections: [section]
  });

  return Packer.toBuffer(doc);
}

function title(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.TITLE
  });
}

function heading(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2
  });
}

function subheading(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_3
  });
}

function paragraph(text: string, options: { color?: string; bold?: boolean } = {}) {
  return new Paragraph({
    children: [run(text, options)],
    spacing: { after: 140, line: 320 }
  });
}

function run(text: string, options: { color?: string; bold?: boolean; size?: number } = {}) {
  return new TextRun({
    text,
    font: {
      ascii: FONT,
      hAnsi: FONT,
      eastAsia: FONT_EAST_ASIA
    },
    color: options.color ?? "374151",
    ...(options.bold !== undefined ? { bold: options.bold } : {}),
    size: options.size ?? 21
  });
}

function spacer(after: number) {
  return new Paragraph({ spacing: { after } });
}

function metaBlock(minutes: MeetingMinutesJson) {
  const rows: Array<[string, string]> = [
    ["主题", minutes.meeting_background.topic],
    ["时间", minutes.meeting_background.time],
    ["参与人", minutes.meeting_background.participants.join("、") || "待定"]
  ];

  return rows.map(
    ([label, value], index) =>
      new Paragraph({
        children: [run(`${label}：`, { bold: true, color: "6B7280" }), run(value, { color: "6B7280" })],
        shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
        border: {
          left: border("CBD5E1", 12)
        },
        indent: { left: 180 },
        spacing: {
          before: index === 0 ? 120 : 0,
          after: index === rows.length - 1 ? 260 : 60,
          line: 320
        }
      })
  );
}

function visualImageBlock(image: LoadedImage) {
  const maxWidth = Math.round(CONTENT_WIDTH_TWIP / 20);
  const naturalRatio = image.height / Math.max(image.width, 1);
  const width = Math.min(560, maxWidth);
  const height = Math.min(520, Math.round(width * naturalRatio));
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 260 },
    children: [
      new ImageRun({
        type: "png",
        data: image.buffer,
        transformation: { width, height },
        altText: {
          title: "会议总结长图预览",
          description: "会议总结长图预览",
          name: "visual-report-preview"
        }
      })
    ]
  });
}

function milestoneCards(minutes: MeetingMinutesJson) {
  const milestones = minutes.visual_summary.milestones.filter((item) => isMeaningful(item.title) || item.bullets.some(isMeaningful));
  return milestones.flatMap((item) => [
    callout(`${item.date}｜${item.title}`, "EFF6FF", "2563EB"),
    ...item.bullets.filter(isMeaningful).map((bullet) => paragraph(`- ${bullet}`))
  ]);
}

function riskCards(minutes: MeetingMinutesJson) {
  return minutes.visual_summary.risk_cards.filter((risk) => isMeaningful(risk.title) && isMeaningful(risk.description)).map((risk) =>
    callout(
      `${risk.title}（${risk.level}风险）\n${risk.description}${risk.impact ? `\n影响：${risk.impact}` : ""}${risk.suggestion ? `\n建议：${risk.suggestion}` : ""}`,
      "FFF1F2",
      "E11D48"
    )
  );
}

function moduleProgress(minutes: MeetingMinutesJson) {
  return minutes.module_progress.filter((module) => isMeaningful(module.module_name) && (isMeaningful(module.current_status) || module.progress_items.some(isMeaningful))).flatMap((module) => [
    subheading(module.module_name),
    paragraph(`当前状态：${module.current_status}`),
    ...module.progress_items.filter(isMeaningful).map((item) => paragraph(`- ${item}`)),
    ...(module.blockers?.some(isMeaningful) ? [paragraph("阻塞：", { bold: true }), ...module.blockers.filter(isMeaningful).map((item) => paragraph(`- ${item}`))] : []),
    ...(module.next_steps?.some(isMeaningful) ? [paragraph("下一步：", { bold: true }), ...module.next_steps.filter(isMeaningful).map((item) => paragraph(`- ${item}`))] : [])
  ]);
}

function insightCards(minutes: MeetingMinutesJson) {
  return minutes.ai_insights.filter((item) => isMeaningful(item.title) || isMeaningful(item.content)).map((item) =>
    callout(`${item.title}\n${item.content}${item.suggestion ? `\n建议：${item.suggestion}` : ""}`, "FFFBEB", "D97706")
  );
}

function todoItems(minutes: MeetingMinutesJson) {
  return minutes.todos.filter((item) => isMeaningful(item.text)).map((item) => paragraph(`${item.checked ? "[x]" : "[ ]"} ${item.text}`));
}

function chapterTimeline(minutes: MeetingMinutesJson) {
  const chapters = normalizeChapters(minutes.chapters);
  return chapters.map((chapter) => paragraph(`${chapter.start_time}  ${chapter.title}：${chapter.summary}`));
}

function numbered(lines: string[]) {
  return lines.filter(isMeaningful).map((line, index) => paragraph(`${index + 1}. ${line}`));
}

function actionTable(minutes: MeetingMinutesJson) {
  const actionItems = minutes.action_items.filter((item) => isMeaningful(item.action));
  if (actionItems.length === 0) return null;

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        headerCell("行动项", 45),
        headerCell("负责人", 16),
        headerCell("截止时间", 20),
        headerCell("状态", 19)
      ]
    }),
    ...actionItems.map(
      (item) =>
        new TableRow({
          children: [bodyCell(item.action, 45), bodyCell(isMeaningful(item.owner) ? item.owner : "待定", 16), bodyCell(isMeaningful(item.due_date) ? item.due_date : "待定", 20), bodyCell(item.status, 19)]
        })
    )
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    rows
  });
}

function headerCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    shading: { type: ShadingType.CLEAR, fill: "EAF2FF" },
    verticalAlign: VerticalAlign.CENTER,
    margins: cellMargins(),
    children: [paragraph(text, { bold: true, color: "1D4ED8" })]
  });
}

function bodyCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.TOP,
    margins: cellMargins(),
    children: [paragraph(text || "-", { color: "374151" })]
  });
}

function callout(text: string, fill: string, accent: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    borders: noBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill },
            borders: {
              top: border("E5E7EB"),
              bottom: border("E5E7EB"),
              left: border(accent, 16),
              right: border("E5E7EB")
            },
            margins: { top: 150, bottom: 150, left: 180, right: 180 },
            children: text.split("\n").map((line, index) => paragraph(line, { bold: index === 0, color: index === 0 ? accent : "374151" }))
          })
        ]
      })
    ]
  });
}

function normalizeChapters(chapters: MeetingMinutesJson["chapters"]) {
  return chapters
    .filter((chapter) => isMeaningful(chapter.title) && isMeaningful(chapter.summary) && chapter.summary.trim() !== "---")
    .slice(0, 12);
}

function isMeaningful(value: string | undefined | null) {
  const normalized = `${value ?? ""}`.trim();
  return Boolean(normalized && !["暂无", "无", "无明确", "待定", "-", "--", "---", "null", "undefined"].includes(normalized));
}

type LoadedImage = {
  buffer: Buffer;
  width: number;
  height: number;
};

function loadVisualImage(path?: string): LoadedImage | null {
  if (!path || !existsSync(path)) return null;
  const buffer = readFileSync(path);
  const size = readPngSize(buffer);
  if (!size) return null;
  return { buffer, ...size };
}

function readPngSize(buffer: Buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function compact<T>(items: Array<T | null | undefined | false>) {
  return items.filter(Boolean) as T[];
}

function cellMargins() {
  return { top: 110, bottom: 110, left: 110, right: 110 };
}

function noBorders() {
  return {
    top: border("FFFFFF", 0),
    bottom: border("FFFFFF", 0),
    left: border("FFFFFF", 0),
    right: border("FFFFFF", 0),
    insideHorizontal: border("FFFFFF", 0),
    insideVertical: border("FFFFFF", 0)
  };
}

function mutedBorders() {
  return {
    top: border("E5E7EB"),
    bottom: border("E5E7EB"),
    left: border("E5E7EB"),
    right: border("E5E7EB")
  };
}

function leftAccentBorder() {
  return {
    top: border("E5E7EB"),
    bottom: border("E5E7EB"),
    left: border("CBD5E1", 12),
    right: border("E5E7EB")
  };
}

function border(color: string, size = 6) {
  return { style: BorderStyle.SINGLE, size, color };
}
