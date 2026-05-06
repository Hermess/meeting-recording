import { serverApiGet } from "../../../../lib/server-api";
import { ReviewMeetingClient } from "./ReviewMeetingClient";

type MeetingDetail = {
  id: string;
  title: string;
  projectName?: string | null;
  meetingType: string;
  inputMode?: "record" | "upload";
  startTime?: string | null;
  endTime?: string | null;
  participants?: string[];
  summaryModelConfigId?: string;
  status: string;
  lastError?: string | null;
  transcriptSegments?: TranscriptSegment[];
  recordingAssets?: RecordingAsset[];
  yuqueRepoNamespace?: string | null;
  yuquePublicLevel?: number | null;
  yuqueDocUrl?: string | null;
};

type TranscriptSegment = {
  id: string;
  index: number;
  speaker?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  text: string;
  isFinal: boolean;
  provider: string;
  createdAt?: string;
};

type RecordingAsset = {
  id: string;
  filename: string;
  originalName?: string | null;
  mimeType: string;
  sizeBytes: number;
  publicUrl: string;
  createdAt: string;
};

type MeetingMinutes = {
  id: string;
  structuredJson: unknown;
  markdownContent: string;
  promptVersion: string;
  createdAt: string;
  updatedAt: string;
};

type VisualReport = {
  id: string;
  imagePath?: string | null;
  imageUrl?: string | null;
  htmlPath?: string | null;
  createdAt: string;
};

export default async function ReviewMeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, minutesResult, visualResult] = await Promise.all([
    serverApiGet<MeetingDetail>(`/api/meetings/${id}`),
    serverApiGet<MeetingMinutes>(`/api/meetings/${id}/minutes`),
    serverApiGet<VisualReport>(`/api/meetings/${id}/visual-report`)
  ]);
  const meeting = result.data;
  const minutes = minutesResult.data ?? null;
  const visualReport = visualResult.data ?? null;

  return (
    <div className="space-y-6">
      <section className="page-toolbar">
        <div>
          <p className="text-sm font-medium text-muted">会议纪要</p>
          <h2 className="page-title">{meeting?.title ?? "会议纪要"}</h2>
          <p className="page-subtitle">
            编辑会议纪要正文，生成总结长图、Word，并发布到语雀。
          </p>
        </div>
      </section>

      {result.error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          无法加载会议详情：{result.error}
        </div>
      ) : null}

      {meeting ? (
        <ReviewMeetingClient initialMeeting={meeting} initialMinutes={minutes} initialVisualReport={visualReport} />
      ) : null}
    </div>
  );
}
