"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiDelete } from "../../lib/api";

type DeleteMeetingResponse = {
  id: string;
  deleted: boolean;
  cleanupWarnings?: string[];
};

export function DeleteMeetingButton({ meetingId, title }: { meetingId: string; title: string }) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleDelete() {
    if (isDeleting) {
      return;
    }
    const confirmed = window.confirm(`确认删除“${title}”？\n\n删除后会移除会议、转写、纪要、长图和本地录音文件，无法从列表恢复。`);
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    const result = await apiDelete<DeleteMeetingResponse>(`/api/meetings/${meetingId}`);
    setIsDeleting(false);

    if (result.error) {
      window.alert(`删除失败：${result.error}`);
      return;
    }

    const warnings = result.data?.cleanupWarnings ?? [];
    if (warnings.length > 0) {
      window.alert(`会议已删除，但有 ${warnings.length} 个本地文件清理提醒。可稍后检查 storage 目录。`);
    }
    router.refresh();
  }

  return (
    <button className="list-action danger" disabled={isDeleting} onClick={() => void handleDelete()} type="button">
      {isDeleting ? "删除中" : "删除"}
    </button>
  );
}
