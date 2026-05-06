import { SettingsClient } from "./SettingsClient";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <section className="page-toolbar">
        <div>
          <h2 className="page-title">设置</h2>
          <p className="page-subtitle">
            按配置类别管理个人账号下的模型网关、实时 ASR、语雀发布和个人热词。密钥字段会在后端加密保存。
          </p>
        </div>
      </section>

      <SettingsClient />
    </div>
  );
}
