import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";

type FallbackMeeting = {
  title: string;
  meetingType: string;
  projectName?: string | null;
  startTime?: Date | null;
  endTime?: Date | null;
  participants: unknown;
};

type FallbackSegment = {
  id: string;
  index: number;
  text: string;
  startMs?: number | null;
};

export function buildFallbackMinutesJson(meeting: FallbackMeeting, segments: FallbackSegment[]): MeetingMinutesJson {
  const participants = Array.isArray(meeting.participants) ? meeting.participants.map(String) : [];
  const transcriptText = segments.map((segment) => segment.text).join("\n");
  const sections = parseStructuredSections(transcriptText);
  const keySentences = pickKeySentences(transcriptText);
  const firstSegment = segments[0];
  const actionItems = extractActionItems(keySentences, sections);
  const riskCards = extractRiskCards(keySentences, sections);
  const decisions = extractDecisions(keySentences, sections, firstSegment?.id);
  const moduleProgress = extractModuleProgress(meeting, keySentences, sections);
  const summary = buildSummaryParagraph(keySentences, sections);
  const topic = extractField(transcriptText, "会议主题") ?? meeting.title;
  const meetingTime = extractField(transcriptText, "会议日期") ?? formatMeetingTime(meeting.startTime, meeting.endTime);

  return {
    meeting_background: {
      title: extractTitle(transcriptText) ?? meeting.title,
      topic,
      time: meetingTime,
      participants,
      meeting_type: meeting.meetingType
    },
    executive_summary: {
      title: meeting.title,
      subtitle: "基础纪要回退版本",
      one_sentence_conclusion: keySentences[0] ?? "本次会议内容已完成基础整理。",
      summary_paragraph: summary
    },
    visual_summary: {
      milestones: extractMilestones(keySentences, sections),
      risk_cards: riskCards,
      key_actions: actionItems.map((item) => ({
        title: item.action,
        owner: item.owner,
        due_date: item.due_date,
        status: item.status
      })),
      core_consensus: keySentences[0] ?? "暂无明确共识，建议补充人工确认。"
    },
    module_progress: moduleProgress,
    decisions,
    action_items: actionItems,
    ai_insights: [
      {
        title: "基础回退提示",
        content: "当前纪要由规则回退生成，但已尽量按原始标题、章节、行动计划和风险点提取结构化内容。",
        risk_level: "中",
        suggestion: "正式发布前建议使用已配置的纪要模型重新生成，或在会议纪要页编辑正文后点击“应用修改”。"
      }
    ],
    todos: actionItems.map((item) => ({
      text: item.action,
      checked: false
    })),
    chapters: extractChapters(sections, segments)
  };
}

function pickKeySentences(text: string) {
  return text
    .split(/(?<=[。！？!?])\s*|\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 6)
    .slice(0, 8);
}

function extractRiskCards(sentences: string[], sections: StructuredSection[]): MeetingMinutesJson["visual_summary"]["risk_cards"] {
  const riskLines = sectionLines(sections, /风险|关注点|阻塞/);
  const candidates = riskLines.length > 0 ? riskLines : sentences;
  return candidates
    .filter((sentence) => /风险|阻塞|延期|问题|偏差|失败|异常/.test(sentence))
    .slice(0, 6)
    .map((sentence) => ({
      title: sentence.slice(0, 24),
      level: "中",
      description: sentence,
      suggestion: "建议明确负责人和截止时间。"
    }));
}

function extractActionItems(sentences: string[], sections: StructuredSection[]): MeetingMinutesJson["action_items"] {
  const actionLines = sectionLines(sections, /行动计划|安排|关键节点|待办/);
  const candidates = (actionLines.length > 0 ? actionLines : sentences)
    .filter((sentence) => /需要|需|推进|完成|确认|确定|评审|对齐|跟进|处理|补充|研究|进入/.test(sentence))
    .filter((sentence) => !isMetadataLine(sentence))
    .slice(0, 8);

  return candidates.map((sentence) => ({
    action: sentence,
    owner: extractOwners(sentence),
    due_date: extractDueDate(sentence),
    status: "待定",
    evidence_text: sentence,
    evidence_segment_ids: []
  }));
}

type StructuredSection = {
  title: string;
  lines: string[];
};

function parseStructuredSections(text: string): StructuredSection[] {
  const sections: StructuredSection[] = [];
  let current: StructuredSection | null = null;
  for (const rawLine of text.split(/\n+/)) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const heading =
      line.match(/^#{1,3}\s*(.+)$/) ??
      line.match(/^[一二三四五六七八九十]+、\s*(.+)$/) ??
      line.match(/^第[一二三四五六七八九十]+[章节部分][：:、\s]*(.+)$/);
    if (heading?.[1]) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (!current) {
      current = { title: "会议概览", lines: [] };
      sections.push(current);
    }
    current.lines.push(line);
  }
  return sections;
}

function extractTitle(text: string) {
  return text
    .split(/\n+/)
    .map((line) => cleanLine(line))
    .find((line) => line && !line.includes("：") && !line.startsWith("---"));
}

function extractField(text: string, fieldName: string) {
  const pattern = new RegExp(`${fieldName}[：:]\\s*(.+)`);
  const matched = text.match(pattern);
  return matched?.[1]?.trim();
}

function buildSummaryParagraph(sentences: string[], sections: StructuredSection[]) {
  const goal = sectionLines(sections, /核心目标|目标|安排/).filter((line) => !isMetadataLine(line)).slice(0, 3);
  const architecture = sectionLines(sections, /整体架构|架构规划|关键技术/).filter((line) => !isMetadataLine(line)).slice(0, 4);
  const actions = sectionLines(sections, /行动计划|关键节点/).filter((line) => !isMetadataLine(line)).slice(0, 3);
  const risks = sectionLines(sections, /风险|关注点/).filter((line) => !isMetadataLine(line)).slice(0, 3);
  const parts: string[] = [];
  if (goal.length > 0) {
    parts.push(`本次会议围绕项目目标、需求主干和关键节点展开，明确了${goal.join("、")}。`);
  }
  if (architecture.length > 0) {
    parts.push(`技术方案层面，会议重点讨论了${architecture.join("、")}。`);
  }
  if (actions.length > 0) {
    parts.push(`后续推进上，会议形成了${actions.join("、")}等安排。`);
  }
  if (risks.length > 0) {
    parts.push(`同时需要关注${risks.join("、")}等风险。`);
  }
  if (parts.length > 0) {
    return parts.join("");
  }
  return sentences.filter((sentence) => !isMetadataLine(sentence)).slice(0, 4).join("。") || "本次会议已完成转写沉淀，等待接入纪要模型后生成更高质量的结构化纪要。";
}

function extractMilestones(sentences: string[], sections: StructuredSection[]): MeetingMinutesJson["visual_summary"]["milestones"] {
  const source = [...sectionLines(sections, /行动计划|关键节点|核心目标/), ...sentences];
  const dated = source
    .filter((line) => /\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{1,2}-\d{1,2}/.test(line))
    .slice(0, 4);
  const fallback = dated.length > 0 ? dated : source.slice(0, 3);
  return fallback.map((line) => ({
    date: extractDueDate(line),
    title: line.slice(0, 32),
    bullets: [line]
  }));
}

function extractDecisions(sentences: string[], sections: StructuredSection[], evidenceSegmentId?: string): MeetingMinutesJson["decisions"] {
  const decisionLines = sectionLines(sections, /关键技术决策|核心目标|整体架构/);
  const source = (decisionLines.length > 0 ? decisionLines : sentences).slice(0, 8);
  return source.map((line) => ({
    decision: line,
    type: /需|可能|探索|建议/.test(line) ? "待验证" : "已确认",
    evidence_text: line,
    evidence_segment_ids: evidenceSegmentId ? [evidenceSegmentId] : []
  }));
}

function extractModuleProgress(
  meeting: FallbackMeeting,
  sentences: string[],
  sections: StructuredSection[]
): MeetingMinutesJson["module_progress"] {
  const meaningfulSections = sections.filter((section) => section.lines.length > 0 && !/会议概览/.test(section.title)).slice(0, 6);
  if (meaningfulSections.length === 0) {
    return [
      {
        module_name: "会议整体",
        current_status: "已完成基础转写整理",
        progress_items: sentences.slice(0, 5),
        blockers: [],
        next_steps: ["使用纪要模型或人工编辑补全结构化内容"]
      }
    ];
  }
  return meaningfulSections.map((section) => ({
    module_name: section.title,
    current_status: "已整理",
    progress_items: section.lines.filter((line) => !/风险|阻塞|问题|偏差/.test(line)).slice(0, 6),
    blockers: section.lines.filter((line) => /风险|阻塞|问题|偏差/.test(line)).slice(0, 4),
    next_steps: section.lines.filter((line) => /需要|需|推进|完成|确认|确定|评审|跟进|研究/.test(line)).slice(0, 4)
  }));
}

function extractChapters(sections: StructuredSection[], segments: FallbackSegment[]): MeetingMinutesJson["chapters"] {
  const structuredChapters = sections
    .filter((section) => section.lines.length > 0)
    .slice(0, 12)
    .map((section, index) => ({
      start_time: formatMs(index * 60000),
      title: section.title,
      summary: section.lines.slice(0, 3).join("；")
    }));
  if (structuredChapters.length > 0) return structuredChapters;
  return segments.slice(0, 12).map((segment) => ({
    start_time: formatMs(segment.startMs ?? segment.index * 60000),
    title: `转写段落 ${segment.index + 1}`,
    summary: segment.text
  }));
}

function sectionLines(sections: StructuredSection[], titlePattern: RegExp) {
  return sections
    .filter((section) => titlePattern.test(section.title))
    .flatMap((section) => section.lines)
    .map(cleanLine)
    .filter(Boolean);
}

function cleanLine(value: string) {
  return value
    .replace(/^[-•]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .trim();
}

function isMetadataLine(value: string) {
  return /^(会议日期|会议主题|参与人|参会人)[：:]/.test(value) || value === "---" || /^[一二三四五六七八九十]+、/.test(value);
}

function extractOwners(sentence: string) {
  const mentions = [...sentence.matchAll(/@([^\s@()（）]+)(?:[（(][^)）]+[)）])?/g)].map((match) => match[1]).filter(Boolean);
  return mentions.length > 0 ? mentions.join("、") : "待定";
}

function extractDueDate(sentence: string) {
  return sentence.match(/\d{4}年\d{1,2}月\d{1,2}日/)?.[0] ?? sentence.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0] ?? "待定";
}

function formatMeetingTime(startTime?: Date | null, endTime?: Date | null) {
  if (!startTime && !endTime) {
    return "待定";
  }

  return [startTime?.toISOString(), endTime?.toISOString()].filter(Boolean).join(" 至 ");
}

function formatMs(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
