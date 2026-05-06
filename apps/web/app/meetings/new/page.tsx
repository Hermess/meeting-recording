import { NewMeetingForm } from "./NewMeetingForm";

export default function NewMeetingPage() {
  return (
    <div className="space-y-6">
      <section className="page-toolbar">
        <div>
          <h2 className="page-title">新建会议</h2>
          <p className="page-subtitle">
            可选择现场录音转写，或先上传/粘贴已有会议材料，再生成 AI 纪要和总结长图。
          </p>
        </div>
      </section>

      <NewMeetingForm />
    </div>
  );
}
