import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";

export type MinutesQualityAudit = {
  approved: boolean;
  score: number;
  issues: string[];
  warnings: string[];
};

export function auditMinutesQuality(input: {
  minutes: MeetingMinutesJson;
  modelConfigId?: string | null;
  rawTranscript?: string;
}): MinutesQualityAudit {
  const issues: string[] = [];
  const warnings: string[] = [];
  const rawTranscript = input.rawTranscript ?? "";
  const minutes = input.minutes;

  if (input.modelConfigId?.includes("fallback") || input.modelConfigId === "fallback_basic_v1") {
    issues.push("当前纪要由基础规则兜底生成，不能直接输出长图或发布。请重新调用纪要模型，或人工编辑后应用修改。");
  }

  if (minutes.ai_insights.some((item) => /基础回退|回退提示|fallback/i.test(`${item.title} ${item.content}`))) {
    issues.push("纪要仍包含基础回退提示，说明结构化质量未达到发布标准。");
  }

  const summary = minutes.executive_summary.summary_paragraph.trim();
  const semicolonCount = (summary.match(/[；;]/g) ?? []).length;
  if (summary.length > 240 && semicolonCount >= 8) {
    issues.push("会议总结像转写片段拼接，缺少归纳后的结构化表达。");
  }
  if (/会议日期[：:]|会议主题[：:]|---/.test(summary)) {
    issues.push("会议总结混入了原始元信息或分隔符，应改写为管理者可读的概括段。");
  }

  const actionMetadataItems = minutes.action_items.filter((item) => isMetadataLine(item.action));
  if (actionMetadataItems.length > 0) {
    issues.push(`行动项中包含元信息或标题行：${actionMetadataItems.map((item) => item.action).slice(0, 3).join("；")}`);
  }

  const milestoneMetadataItems = minutes.visual_summary.milestones.filter((item) => isMetadataLine(item.title) || item.bullets.some(isMetadataLine));
  if (milestoneMetadataItems.length > 0) {
    issues.push("核心里程碑中包含会议日期、会议主题或章节标题等元信息。");
  }

  const hasStructuredSource = /(^|\n)[一二三四五六七八九十]+、|会议日期[：:]|会议主题[：:]|行动计划|风险与关注点|关键技术决策/.test(rawTranscript);
  if (hasStructuredSource && minutes.chapters.filter((chapter) => isMeaningful(chapter.title) && isMeaningful(chapter.summary)).length < 3) {
    issues.push("原文已有清晰章节，但纪要章节提取不足。");
  }

  if (/风险与关注点|风险|关注点/.test(rawTranscript) && minutes.visual_summary.risk_cards.filter((risk) => isMeaningful(risk.title) && isMeaningful(risk.description)).length === 0) {
    issues.push("原文包含风险或关注点，但长图风险卡为空。");
  }

  if (/行动计划|关键节点|需在|需要|须在/.test(rawTranscript) && minutes.action_items.filter((item) => isMeaningful(item.action)).length === 0) {
    issues.push("原文包含行动计划或关键节点，但行动项为空。");
  }

  if (/关键技术决策|技术决策|共识/.test(rawTranscript) && minutes.decisions.filter((item) => isMeaningful(item.decision)).length < 2) {
    warnings.push("关键决策数量偏少，建议检查是否漏掉通信协议、鉴权、会话记忆、工具集成等决策。");
  }

  if (summary.length < 60 && rawTranscript.length > 600) {
    warnings.push("会议总结偏短，可能没有覆盖完整会议内容。");
  }

  const score = Math.max(0, 100 - issues.length * 25 - warnings.length * 8);
  return {
    approved: issues.length === 0,
    score,
    issues,
    warnings
  };
}

export function buildMinutesQualityError(audit: MinutesQualityAudit) {
  return `纪要质量审核未通过：${audit.issues.join("；")}`;
}

function isMetadataLine(value: string | undefined | null) {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) return false;
  if (/^[-#\s]*$/.test(normalized)) return true;
  if (/^(会议日期|会议主题|会议纪要|参与人|参会人)[：:]/.test(normalized)) return true;
  if (/^[一二三四五六七八九十]+、\s*\S+/.test(normalized)) return true;
  if (/^第[一二三四五六七八九十]+[章节部分]/.test(normalized)) return true;
  return normalized === "---";
}

function isMeaningful(value: string | undefined | null) {
  const normalized = `${value ?? ""}`.trim();
  return Boolean(normalized && !["暂无", "无", "无明确", "待定", "-", "--", "---", "null", "undefined"].includes(normalized));
}
