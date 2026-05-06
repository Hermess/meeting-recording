import { createElement, type ReactNode } from "react";
import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";

export const PROJECT_BIWEEKLY_TEMPLATE_ID = "project_biweekly_v1";

export type VisualTemplateConfig = {
  id: typeof PROJECT_BIWEEKLY_TEMPLATE_ID;
  name: string;
  width: 1080;
  scale: 2;
  theme: {
    primary: string;
    risk: string;
    warning: string;
    success: string;
  };
};

export const PROJECT_BIWEEKLY_TEMPLATE: VisualTemplateConfig = {
  id: PROJECT_BIWEEKLY_TEMPLATE_ID,
  name: "会议总结长图",
  width: 1080,
  scale: 2,
  theme: {
    primary: "#2563eb",
    risk: "#e11d48",
    warning: "#d97706",
    success: "#16a34a"
  }
};

export type ProjectBiweeklyVisualReportProps = {
  data: MeetingMinutesJson;
};

export function ProjectBiweeklyVisualReport({ data }: ProjectBiweeklyVisualReportProps) {
  const isProjectBiweekly = data.meeting_background.meeting_type === "project_biweekly";
  const reportLabel = "会议纪要报告";
  const metaPanels = [
    { label: "时间", value: data.meeting_background.time },
    { label: "参与人", value: data.meeting_background.participants.join("、") },
    { label: "主题", value: data.meeting_background.topic }
  ].filter((item) => isMeaningful(item.value));
  const milestones = dedupeBy(
    data.visual_summary.milestones.filter(
      (item) => (isMeaningful(item.title) || isMeaningful(item.bullets.join(""))) && !isMetadataLike(item.title)
    ),
    (item) => `${item.date}-${item.title}`
  ).slice(0, 4);
  const risks = data.visual_summary.risk_cards.filter((risk) => isMeaningful(risk.title) && isMeaningful(risk.description));
  const decisions = data.decisions.filter((item) => isMeaningful(item.decision) && !isMetadataLike(item.decision)).slice(0, 5);
  const actions = dedupeBy(
    data.action_items.filter((item) => isMeaningful(item.action) && !isMetadataLike(item.action)),
    (item) => item.action
  );
  const displayActions = actions.slice(0, 6);
  const insights = data.ai_insights.filter((item) => isMeaningful(item.title) || isMeaningful(item.content));
  const displayChapters = normalizeChapters(data.chapters);
  return h(
    "main",
    {
      "data-visual-report": "project-biweekly-v1",
      style: {
        width: PROJECT_BIWEEKLY_TEMPLATE.width,
        background: "#ffffff",
        color: "#1f2937",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        padding: 48
      }
    },
    h(
      "header",
      { style: { borderBottom: "1px solid #e5e7eb", paddingBottom: 24 } },
      h("p", { style: { color: "#2563eb", fontSize: 18, fontWeight: 700, margin: 0 } }, reportLabel),
      h(
        "h1",
        { style: { fontSize: 42, lineHeight: 1.2, margin: "10px 0 0" } },
        data.executive_summary.title || data.meeting_background.title
      ),
      h(
        "p",
        { style: { color: "#6b7280", fontSize: 20, lineHeight: 1.6, margin: "12px 0 0" } },
        data.executive_summary.one_sentence_conclusion
      )
    ),
    h(
      "section",
      { style: { display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 28 } },
      ...metaPanels.map((item) => h(SummaryPanel, { key: item.label, label: item.label, value: item.value ?? "" }))
    ),
    milestones.length > 0
      ? h(
          Section,
          { title: isProjectBiweekly ? "核心里程碑" : "关键节点" },
          h(
            "div",
            { style: { display: "grid", gap: 14 } },
            ...milestones.map((item) =>
              h(
                "article",
                { key: `${item.date}-${item.title}`, style: { background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 18 } },
                h("p", { style: { color: "#16a34a", fontSize: 16, fontWeight: 700, margin: 0 } }, isMeaningful(item.date) ? item.date : "待定"),
                h("h3", { style: { fontSize: 20, margin: "8px 0" } }, item.title),
                h("p", { style: { fontSize: 17, lineHeight: 1.7, margin: 0 } }, item.bullets.filter(isMeaningful).join("；"))
              )
            )
          )
        )
      : null,
    h(
      Section,
      { title: "会议总结" },
      h("p", { style: { fontSize: 20, lineHeight: 1.8, margin: 0 } }, data.executive_summary.summary_paragraph)
    ),
    decisions.length > 0 || isMeaningful(data.visual_summary.core_consensus)
      ? h(
          Section,
          { title: "关键决策与共识" },
          h(
            "div",
            { style: { display: "grid", gap: 14 } },
            isMeaningful(data.visual_summary.core_consensus)
              ? h(
                  "article",
                  { style: { background: "#eef2ff", border: "1px solid #c7d2fe", borderRadius: 12, padding: 18 } },
                  h("strong", { style: { color: "#3730a3", fontSize: 20 } }, "核心共识"),
                  h("p", { style: { fontSize: 18, lineHeight: 1.7, margin: "8px 0 0" } }, data.visual_summary.core_consensus)
                )
              : null,
            ...decisions.map((item) =>
              h(
                "article",
                { key: item.decision, style: { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18 } },
                h("strong", { style: { color: "#111827", fontSize: 19 } }, item.decision)
              )
            )
          )
        )
      : null,
    risks.length > 0
      ? h(
          Section,
          { title: "核心风险" },
          h(
            "div",
            { style: { display: "grid", gap: 16 } },
            ...risks.map((risk) =>
              h(
                "article",
                {
                  key: risk.title,
                  style: { background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 12, padding: 18 }
                },
                h("strong", { style: { color: "#be123c", fontSize: 20 } }, `${risk.title} · ${risk.level}`),
                h("p", { style: { fontSize: 18, lineHeight: 1.7, margin: "8px 0 0", wordBreak: "break-word" } }, risk.description),
                isMeaningful(risk.suggestion) ? h("p", { style: { color: "#9f1239", fontSize: 16, lineHeight: 1.6, margin: "8px 0 0" } }, `建议：${risk.suggestion}`) : null
              )
            )
          )
        )
      : null,
    displayActions.length > 0
      ? h(
          Section,
          { title: "关键行动" },
          h(
            "table",
            { style: { borderCollapse: "collapse", tableLayout: "fixed", width: "100%" } },
            h(
              "thead",
              null,
              h(
                "tr",
                null,
                ...["事项", "负责人", "截止时间", "状态"].map((header) =>
                  h(
                    "th",
                    {
                      key: header,
                      style: {
                        background: "#eff6ff",
                        border: "1px solid #bfdbfe",
                        fontSize: 16,
                        padding: 12,
                        textAlign: "left"
                      }
                    },
                    header
                  )
                )
              )
            ),
            h(
              "tbody",
              null,
              ...displayActions.map((item) =>
                h(
                  "tr",
                  { key: `${item.action}-${item.owner}` },
                  h("td", { style: cellStyle }, item.action),
                  h("td", { style: cellStyle }, isMeaningful(item.owner) ? item.owner : "待定"),
                  h("td", { style: cellStyle }, isMeaningful(item.due_date) ? item.due_date : "待定"),
                  h("td", { style: cellStyle }, item.status)
                )
              )
            )
          ),
          actions.length > displayActions.length
            ? h(
                "p",
                { style: { color: "#64748b", fontSize: 15, lineHeight: 1.6, margin: "12px 0 0" } },
                `另有 ${actions.length - displayActions.length} 项行动项已保留在纪要正文中。`
              )
            : null
        )
      : null,
    insights.length > 0
      ? h(
          Section,
          { title: "AI 洞察" },
          h(
            "div",
            { style: { display: "grid", gap: 14 } },
            ...insights.map((item) =>
              h(
                "article",
                { key: item.title, style: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12, padding: 18 } },
                h("strong", { style: { color: "#92400e", fontSize: 20 } }, item.title),
                isMeaningful(item.content) ? h("p", { style: { fontSize: 18, lineHeight: 1.7, margin: "8px 0 0", wordBreak: "break-word" } }, item.content) : null,
                isMeaningful(item.suggestion) ? h("p", { style: { color: "#92400e", fontSize: 16, lineHeight: 1.6, margin: "8px 0 0" } }, `建议：${item.suggestion}`) : null
              )
            )
          )
        )
      : null,
    displayChapters.length > 0
      ? h(
          Section,
          { title: "章节时间轴" },
          h(
            "div",
            { style: { display: "grid", gap: 12, borderLeft: "4px solid #bfdbfe", paddingLeft: 18 } },
            ...displayChapters.map((item) =>
              h(
                "article",
                { key: `${item.start_time}-${item.title}`, style: { paddingBottom: 10 } },
                h("p", { style: { color: "#2563eb", fontSize: 16, fontWeight: 700, margin: 0 } }, item.start_time),
                h("h3", { style: { fontSize: 20, margin: "6px 0" } }, item.title),
                h("p", { style: { color: "#4b5563", fontSize: 17, lineHeight: 1.7, margin: 0 } }, item.summary)
              )
            )
          )
        )
      : null
  );
}

function SummaryPanel({ label, value }: { label: string; value: string }) {
  return h(
    "div",
    { style: { background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 12, padding: 18 } },
    h("p", { style: { color: "#6b7280", fontSize: 15, margin: 0 } }, label),
    h(
      "p",
      { style: { fontSize: 19, fontWeight: 700, lineHeight: 1.5, margin: "8px 0 0", wordBreak: "break-word" } },
      value
    )
  );
}

function Section({ title, children }: { title: string; children?: ReactNode }) {
  return h(
    "section",
    { style: { marginTop: 32 } },
    h("h2", { style: { fontSize: 28, margin: "0 0 16px" } }, title),
    children
  );
}

const cellStyle = {
  border: "1px solid #e5e7eb",
  fontSize: 16,
  lineHeight: 1.6,
  padding: 12,
  verticalAlign: "top",
  wordBreak: "break-word"
} as const;

function normalizeChapters(chapters: MeetingMinutesJson["chapters"]) {
  const filtered = chapters.filter((chapter) => {
    const summary = chapter.summary.trim();
    if (!isMeaningful(chapter.title) || !isMeaningful(summary) || summary === "---") return false;
    if (/^转写段落\s*\d+$/.test(chapter.title) && /^[-#\s]*$/.test(summary)) return false;
    return true;
  });

  const genericCount = filtered.filter((chapter) => /^转写段落\s*\d+$/.test(chapter.title)).length;
  const source = genericCount > filtered.length / 2 ? filtered.filter((chapter) => !/^转写段落\s*\d+$/.test(chapter.title) || chapter.summary.length > 20) : filtered;

  return source.slice(0, 12);
}

function isMeaningful(value: string | undefined | null) {
  const normalized = `${value ?? ""}`.trim();
  return Boolean(normalized && !["暂无", "无", "无明确", "待定", "-", "--", "---", "null", "undefined"].includes(normalized));
}

function isMetadataLike(value: string | undefined | null) {
  const normalized = `${value ?? ""}`.trim();
  return /^(会议日期|会议主题|会议纪要|参与人|参会人)[：:]/.test(normalized) || /^[一二三四五六七八九十]+、/.test(normalized);
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = getKey(item).trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const h = createElement;
