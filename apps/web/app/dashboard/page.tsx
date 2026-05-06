import { serverApiGet } from "../../lib/server-api";
import { DeleteMeetingButton } from "./DeleteMeetingButton";

type MeetingRow = {
  id: string;
  title: string;
  inputMode?: "record" | "upload";
  status: string;
  updatedAt?: string;
  yuqueDocUrl?: string | null;
  counts?: {
    actionItems: number;
    transcriptSegments: number;
    visualReports: number;
  };
};

export default async function DashboardPage() {
  const meetingsResult = await serverApiGet<MeetingRow[]>("/api/meetings");
  const rows = meetingsResult.data ?? [];

  return (
    <div className="space-y-7">
      <section className="page-toolbar">
        <div>
          <h2 className="page-title">主页</h2>
          <p className="page-subtitle">集中管理录音转写、纪要、总结长图和语雀发布记录。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <a className="btn-primary" href="/meetings/new">
            新建会议
          </a>
          <a className="btn-secondary" href="/meetings/new?mode=upload">
            上传 / 粘贴材料
          </a>
          <a className="btn-secondary" href="/settings">
            个人热词
          </a>
        </div>
      </section>

      <section className="workspace-panel overflow-hidden">
        {meetingsResult.error ? (
          <div className="border-b border-line bg-amber-50 px-6 py-3 text-sm text-amber-800">
            无法加载会议列表：{meetingsResult.error}
            {meetingsResult.error.includes("登录") || meetingsResult.error.includes("unauthorized") ? (
              <a className="ml-3 font-semibold text-blue-600" href="/login">
                去登录
              </a>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-5">
          <h3 className="text-lg font-semibold text-ink">文件</h3>
          <div className="flex flex-wrap gap-3">
            <FilterButton label="最近创建/更新" />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex min-h-[520px] flex-col items-center justify-center gap-5 text-center">
            <div className="empty-illustration" aria-hidden="true" />
            <div>
              <p className="text-base font-semibold text-muted">暂无会议文件</p>
              <p className="mt-2 text-sm text-muted">点击右上角“新建会议”创建第一条会议记录。</p>
            </div>
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th className="px-6">文件</th>
                <th className="px-4">状态</th>
                <th className="px-4">内容</th>
                <th className="px-4">最近更新</th>
                <th className="px-6 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const href = primaryActionHref(row);
                return (
                  <tr key={row.id}>
                    <td className="px-6">
                      <a className="block font-semibold text-ink hover:text-brand" href={href}>
                        {row.title}
                      </a>
                      <span className="mt-1 block text-xs text-muted">{row.inputMode === "upload" ? "上传/粘贴" : "录音转写"}</span>
                    </td>
                    <td className="px-4">
                      <span className="status-pill">{statusLabel(row.status)}</span>
                    </td>
                    <td className="px-4">
                      <span>{row.counts?.transcriptSegments ?? 0} 段转写</span>
                      <span className="mx-2 text-line">/</span>
                      <span>{row.counts?.actionItems ?? 0} 项行动</span>
                    </td>
                    <td className="px-4">{formatDate(row.updatedAt)}</td>
                    <td className="px-6 text-right">
                      <div className="inline-flex items-center gap-3">
                        <a className="font-semibold text-blue-600 hover:text-blue-700" href={href}>
                          {primaryActionLabel(row)}
                        </a>
                        {row.yuqueDocUrl ? (
                          <a className="font-semibold text-blue-600 hover:text-blue-700" href={row.yuqueDocUrl} target="_blank">
                            语雀
                          </a>
                        ) : null}
                        <DeleteMeetingButton meetingId={row.id} title={row.title} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function FilterButton({ label }: { label: string }) {
  return (
    <button className="btn-secondary min-w-[132px] justify-between gap-2" type="button">
      <span>{label}</span>
      <span className="text-muted">⌄</span>
    </button>
  );
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "草稿",
    recording: "录音中",
    recorded: "待生成",
    generating: "生成中",
    generated: "已生成",
    rendering: "长图中",
    ready_to_publish: "待发布",
    publishing: "发布中",
    published: "已发布",
    failed: "失败"
  };
  return labels[status] ?? status;
}

function primaryActionHref(row: MeetingRow) {
  if (row.status === "draft" || row.status === "recording") {
    return `/meetings/${row.id}/live`;
  }
  return `/meetings/${row.id}/review`;
}

function primaryActionLabel(row: MeetingRow) {
  if (row.status === "draft" || row.status === "recording") {
    return row.inputMode === "upload" ? "继续导入" : "继续录音";
  }
  if (row.status === "recorded" || row.status === "failed") {
    return "生成纪要";
  }
  return "查看纪要";
}

function formatDate(value?: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
