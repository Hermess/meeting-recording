import { serverApiGet } from "../../../../lib/server-api";
import { LiveMeetingClient } from "./LiveMeetingClient";

type MeetingDetail = {
  id: string;
  title: string;
  projectName?: string | null;
  meetingType: string;
  inputMode?: "record" | "upload";
  status: string;
  lastError?: string | null;
  transcriptSegments?: Array<{
    id: string;
    index: number;
    text: string;
    isFinal: boolean;
    provider: string;
  }>;
  recordingAssets?: Array<{
    id: string;
    filename: string;
    originalName?: string | null;
    mimeType: string;
    sizeBytes: number;
    publicUrl: string;
    createdAt: string;
  }>;
};

export default async function LiveMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await serverApiGet<MeetingDetail>(`/api/meetings/${id}`);
  const meeting = result.data;

  return (
    <div className="space-y-6">
      <section className="page-toolbar">
        <div>
          <p className="text-sm font-medium text-muted">实时转写</p>
          <h2 className="page-title">{meeting?.title ?? "会议转写页"}</h2>
          <p className="page-subtitle">
            通过浏览器麦克风采集音频并转发豆包/火山 ASR，若凭证未配置，也可以使用粘贴转写兜底。
          </p>
        </div>
      </section>

      {result.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          无法加载会议详情：{result.error}
        </div>
      ) : null}

      {meeting ? <LiveMeetingClient initialMeeting={meeting} /> : null}
    </div>
  );
}
