import { ProjectBiweeklyVisualReport } from "@meeting-ai-kit/visual-renderer";
import type { MeetingMinutesJson } from "@meeting-ai-kit/shared";
import { serverApiGet } from "../../../../../lib/server-api";

type MinutesResponse = {
  structuredJson: MeetingMinutesJson;
};

export default async function VisualRenderPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ renderToken?: string }>;
}) {
  const { id } = await params;
  const { renderToken } = await searchParams;
  const result = await serverApiGet<MinutesResponse>(
    `/api/meetings/${id}/minutes`,
    renderToken ? { internalToken: renderToken } : undefined
  );

  if (!result.data) {
    return (
      <main style={{ width: 1080, padding: 48, fontFamily: "sans-serif", background: "#ffffff" }}>
        <h1>会议总结长图尚未生成</h1>
        <p>{result.error ?? "请先生成结构化纪要。"}</p>
      </main>
    );
  }

  return <ProjectBiweeklyVisualReport data={result.data.structuredJson} />;
}
