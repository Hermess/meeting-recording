# Meeting Flow UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the meeting workflow feel like a meeting product: realtime transcription leads to one clear "generate minutes" action, then a user-facing minutes editor and publishing page.

**Architecture:** Keep existing routes and backend contracts. Change user-facing labels and button state logic in the Live and Review pages so implementation concepts like Review and structured JSON sync are hidden behind product language.

**Tech Stack:** Next.js App Router, React client components, existing Fastify APIs.

---

### Task 1: Live Page Single Primary Action

**Files:**
- Modify: `apps/web/app/meetings/[id]/live/LiveMeetingClient.tsx`

- [ ] Replace parallel buttons `生成纪要并预览` and `打开 Review` with one stage-aware primary action.
- [ ] Use product labels: `开始录音并转写`, `结束录音`, `生成会议纪要`, `查看/编辑纪要`.
- [ ] After successful minutes generation, navigate to `/meetings/:id/review`.

### Task 2: Minutes Page Product Language

**Files:**
- Modify: `apps/web/app/meetings/[id]/review/page.tsx`
- Modify: `apps/web/app/meetings/[id]/review/ReviewMeetingClient.tsx`

- [ ] Rename user-facing title from Review to `会议纪要`.
- [ ] Rename `同步结构化数据` to `应用修改`.
- [ ] Track Markdown dirty state and show a warning before image/Word/Feishu actions when Markdown changes have not been applied.
- [ ] Keep JSON behind a debug disclosure only.

### Task 3: Verification

**Files:**
- No production files.

- [ ] Run `pnpm typecheck`.
- [ ] Inspect `/meetings/:id/live` and `/meetings/:id/review` in Chrome.
