import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const VIDEO_FPS = 30;
export const VIDEO_DURATION_IN_FRAMES = 1680;

const colors = {
  ink: "#1f2329",
  muted: "#646a73",
  tertiary: "#8f959e",
  line: "#e5e8ef",
  sidebar: "#f7f9fc",
  mutedSurface: "#f5f7fa",
  brand: "#3370ff",
  brandStrong: "#245bdb",
  brandSoft: "#eef4ff",
  purple: "#7b61ff",
  success: "#00a870",
  warning: "#f5a623",
  danger: "#f54a45",
  white: "#ffffff"
};

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
const easeInOut = Easing.bezier(0.45, 0, 0.55, 1);

export const MeetingAiKitIntro = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: colors.white, color: colors.ink, fontFamily }}>
      <AmbientBackground />
      <ProgressRail />
      <Sequence from={0} durationInFrames={180} premountFor={30}>
        <OpeningScene />
      </Sequence>
      <Sequence from={150} durationInFrames={270} premountFor={30}>
        <ProblemScene />
      </Sequence>
      <Sequence from={390} durationInFrames={330} premountFor={30}>
        <CaptureScene />
      </Sequence>
      <Sequence from={690} durationInFrames={330} premountFor={30}>
        <MinutesScene />
      </Sequence>
      <Sequence from={990} durationInFrames={300} premountFor={30}>
        <DeliveryScene />
      </Sequence>
      <Sequence from={1260} durationInFrames={270} premountFor={30}>
        <PublishScene />
      </Sequence>
      <Sequence from={1500} durationInFrames={180} premountFor={30}>
        <ClosingScene />
      </Sequence>
      <FooterBadge frame={frame} />
    </AbsoluteFill>
  );
};

function OpeningScene() {
  const frame = useCurrentFrame();
  const titleIn = enter(frame, 0, 42);
  const panelIn = enter(frame, 20, 52);
  const drift = interpolate(frame, [0, 180], [0, -18], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneShell opacity={sceneOpacity(frame, 0, 180)}>
      <div style={{ width: 820 }}>
        <Kicker text="Meeting AI Kit / 智能妙记" />
        <h1
          style={{
            margin: "22px 0 0",
            fontSize: 86,
            fontWeight: 800,
            letterSpacing: 0,
            lineHeight: 1.06,
            opacity: titleIn,
            transform: `translateY(${interpolate(titleIn, [0, 1], [28, 0])}px)`
          }}
        >
          把会议声音
          <br />
          变成可交付结论
        </h1>
        <p
          style={{
            margin: "30px 0 0",
            width: 650,
            color: colors.muted,
            fontSize: 30,
            fontWeight: 500,
            lineHeight: 1.55,
            opacity: enter(frame, 26, 42)
          }}
        >
          录音转写、AI 纪要、总结长图、Word / PNG 导出和语雀发布，一条主流程完成。
        </p>
      </div>
      <div style={{ opacity: panelIn, transform: `translateY(${interpolate(panelIn, [0, 1], [36 + drift, drift])}px)` }}>
        <ProductWindow active="主页">
          <DashboardMock />
        </ProductWindow>
      </div>
    </SceneShell>
  );
}

function ProblemScene() {
  const frame = useCurrentFrame();
  const cards = [
    { label: "录音回听", value: "1.5h", color: colors.warning },
    { label: "手工整理", value: "3 docs", color: colors.danger },
    { label: "结论追踪", value: "散落", color: colors.tertiary }
  ];

  return (
    <SceneShell opacity={sceneOpacity(frame, 0, 270)}>
      <div style={{ width: 680 }}>
        <Kicker text="会议结束后" />
        <SceneTitle>真正耗时的工作才开始</SceneTitle>
        <SceneSubtitle>
          讨论记录、关键决策、行动项和汇报材料分散在不同工具里，会议价值很容易丢在整理环节。
        </SceneSubtitle>
      </div>
      <div style={{ display: "grid", width: 760, gap: 22 }}>
        {cards.map((card, index) => {
          const inValue = enter(frame, 14 + index * 12, 34);
          return (
            <div
              key={card.label}
              style={{
                alignItems: "center",
                background: colors.white,
                border: `1px solid ${colors.line}`,
                borderRadius: 18,
                boxShadow: "0 24px 60px rgba(31,35,41,0.08)",
                display: "grid",
                gridTemplateColumns: "84px 1fr 170px",
                height: 116,
                opacity: inValue,
                padding: "0 34px",
                transform: `translateX(${interpolate(inValue, [0, 1], [46, 0])}px)`
              }}
            >
              <SignalIcon color={card.color} index={index} />
              <div>
                <div style={{ color: colors.ink, fontSize: 30, fontWeight: 760 }}>{card.label}</div>
                <div style={{ color: colors.tertiary, fontSize: 20, marginTop: 8 }}>需要人工查找、剪裁、确认</div>
              </div>
              <div style={{ color: card.color, fontSize: 34, fontWeight: 850, textAlign: "right" }}>{card.value}</div>
            </div>
          );
        })}
      </div>
    </SceneShell>
  );
}

function CaptureScene() {
  const frame = useCurrentFrame();
  const waveform = Array.from({ length: 38 }, (_, index) => {
    const height = 20 + Math.abs(Math.sin((frame + index * 8) / 13)) * 78;
    return (
      <div
        key={index}
        style={{
          background: index % 5 === 0 ? colors.purple : colors.brand,
          borderRadius: 999,
          height,
          opacity: 0.34 + (index % 4) * 0.12,
          width: 8
        }}
      />
    );
  });

  return (
    <SceneShell opacity={sceneOpacity(frame, 0, 330)}>
      <div style={{ width: 620 }}>
        <Kicker text="Step 1" />
        <SceneTitle>两种入口，覆盖真实会议材料</SceneTitle>
        <SceneSubtitle>现场录音实时转写；已有材料也可以粘贴或上传 md、doc、docx、pdf。</SceneSubtitle>
        <div style={{ display: "flex", gap: 16, marginTop: 44 }}>
          <RoutePill active label="录音转写" />
          <RoutePill label="上传 / 粘贴" />
        </div>
      </div>
      <ProductWindow active="录音 / 导入" width={850}>
        <div style={{ display: "grid", gap: 22, gridTemplateColumns: "1fr 280px" }}>
          <div style={{ border: `1px solid ${colors.line}`, borderRadius: 14, padding: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: colors.ink, fontSize: 24, fontWeight: 760 }}>实时转写</span>
              <span style={{ color: colors.success, fontSize: 18, fontWeight: 760 }}>ASR 已连接</span>
            </div>
            <div style={{ alignItems: "center", display: "flex", gap: 10, height: 132, margin: "20px 0" }}>{waveform}</div>
            <TranscriptLine frame={frame} delay={12} speaker="张总" text="这个版本的重点，是把会后交付缩短到分钟级。" />
            <TranscriptLine frame={frame} delay={50} speaker="产品" text="风险、决策和行动项需要自动归档到纪要里。" />
            <TranscriptLine frame={frame} delay={88} speaker="运营" text="长图和 Word 都要能直接给业务侧复用。" />
          </div>
          <div style={{ display: "grid", gap: 16 }}>
            <ControlCard title="麦克风" value="系统默认输入" />
            <ControlCard title="录音文件" value="自动分片上传" />
            <ControlCard title="兜底导入" value="粘贴文本 / 上传文档" />
          </div>
        </div>
      </ProductWindow>
    </SceneShell>
  );
}

function MinutesScene() {
  const frame = useCurrentFrame();
  const pulse = interpolate(Math.sin(frame / 18), [-1, 1], [0.92, 1.04]);

  return (
    <SceneShell opacity={sceneOpacity(frame, 0, 330)}>
      <div style={{ width: 620 }}>
        <Kicker text="Step 2" />
        <SceneTitle>AI 把转写整理成结构化纪要</SceneTitle>
        <SceneSubtitle>模型网关输出 Markdown 正文，同时保留结构化 JSON，后续长图、Word 和发布都能复用。</SceneSubtitle>
        <div
          style={{
            alignItems: "center",
            background: colors.brandSoft,
            border: `1px solid rgba(51,112,255,0.18)`,
            borderRadius: 18,
            display: "flex",
            gap: 18,
            marginTop: 42,
            padding: "18px 22px",
            width: 520
          }}
        >
          <div
            style={{
              background: `linear-gradient(135deg, ${colors.brand}, ${colors.purple})`,
              borderRadius: 15,
              height: 54,
              transform: `scale(${pulse})`,
              width: 54
            }}
          />
          <div>
            <div style={{ color: colors.brandStrong, fontSize: 24, fontWeight: 820 }}>默认模型可配置</div>
            <div style={{ color: colors.muted, fontSize: 18, marginTop: 5 }}>支持 OpenAI-compatible 网关</div>
          </div>
        </div>
      </div>
      <ProductWindow active="纪要 Review" width={850}>
        <MinutesMock frame={frame} />
      </ProductWindow>
    </SceneShell>
  );
}

function DeliveryScene() {
  const frame = useCurrentFrame();
  const scan = interpolate(frame, [30, 210], [0, 1], { easing: easeInOut, extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SceneShell opacity={sceneOpacity(frame, 0, 300)}>
      <div style={{ width: 600 }}>
        <Kicker text="Step 3" />
        <SceneTitle>自动生成总结长图</SceneTitle>
        <SceneSubtitle>关键共识、里程碑、风险卡片和行动项会被排成适合汇报转发的视觉报告。</SceneSubtitle>
        <ExportStrip frame={frame} />
      </div>
      <div style={{ position: "relative", width: 820 }}>
        <div
          style={{
            background: colors.white,
            border: `1px solid ${colors.line}`,
            borderRadius: 22,
            boxShadow: "0 28px 80px rgba(31,35,41,0.12)",
            height: 720,
            overflow: "hidden",
            padding: 26,
            transform: `translateY(${interpolate(enter(frame, 0, 46), [0, 1], [34, 0])}px)`
          }}
        >
          <VisualReportMock />
          <div
            style={{
              background: "linear-gradient(90deg, rgba(51,112,255,0), rgba(51,112,255,0.42), rgba(123,97,255,0))",
              height: 4,
              left: 26,
              position: "absolute",
              right: 26,
              top: 72 + scan * 560
            }}
          />
        </div>
      </div>
    </SceneShell>
  );
}

function PublishScene() {
  const frame = useCurrentFrame();

  return (
    <SceneShell opacity={sceneOpacity(frame, 0, 270)}>
      <div style={{ width: 600 }}>
        <Kicker text="Step 4" />
        <SceneTitle>从 Review 到发布，一路闭环</SceneTitle>
        <SceneSubtitle>编辑 Markdown 后同步结构化数据，再导出 Word / PNG，或直接发布到语雀知识库。</SceneSubtitle>
      </div>
      <ProductWindow active="主页" width={880}>
        <div style={{ display: "grid", gap: 14 }}>
          <FileRow frame={frame} delay={8} title="Q2 产品复盘会" status="已发布" meta="38 段转写 / 12 项行动" />
          <FileRow frame={frame} delay={28} title="供应链项目周会" status="待发布" meta="21 段转写 / 7 项行动" />
          <FileRow frame={frame} delay={48} title="客户成功专题会" status="长图中" meta="44 段转写 / 9 项行动" />
          <div
            style={{
              alignItems: "center",
              background: colors.brandSoft,
              borderRadius: 16,
              color: colors.brandStrong,
              display: "flex",
              fontSize: 22,
              fontWeight: 820,
              justifyContent: "space-between",
              marginTop: 10,
              padding: "22px 26px",
              opacity: enter(frame, 78, 36)
            }}
          >
            <span>发布到语雀知识库</span>
            <span style={{ color: colors.success }}>完成</span>
          </div>
        </div>
      </ProductWindow>
    </SceneShell>
  );
}

function ClosingScene() {
  const frame = useCurrentFrame();
  const markIn = enter(frame, 0, 46);

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        background: `linear-gradient(135deg, ${colors.brand} 0%, ${colors.purple} 100%)`,
        color: colors.white,
        display: "flex",
        justifyContent: "center",
        opacity: sceneOpacity(frame, 0, 180)
      }}
    >
      <div style={{ textAlign: "center", transform: `translateY(${interpolate(markIn, [0, 1], [30, 0])}px)`, opacity: markIn }}>
        <div
          style={{
            alignItems: "center",
            background: "rgba(255,255,255,0.16)",
            border: "1px solid rgba(255,255,255,0.28)",
            borderRadius: 24,
            display: "inline-flex",
            fontSize: 28,
            fontWeight: 820,
            gap: 16,
            padding: "18px 26px"
          }}
        >
          <span style={{ background: colors.white, borderRadius: 16, color: colors.brand, padding: "8px 14px" }}>M</span>
          Meeting AI Kit / 智能妙记
        </div>
        <h2 style={{ fontSize: 72, fontWeight: 850, letterSpacing: 0, lineHeight: 1.12, margin: "42px 0 0" }}>
          让每一次会议
          <br />
          都留下清晰的下一步
        </h2>
        <p style={{ fontSize: 26, fontWeight: 560, marginTop: 32, opacity: 0.86 }}>github.com/Hermess/meeting-recording</p>
      </div>
    </AbsoluteFill>
  );
}

function AmbientBackground() {
  const frame = useCurrentFrame();
  const move = interpolate(frame, [0, VIDEO_DURATION_IN_FRAMES], [0, 120]);

  return (
    <AbsoluteFill>
      <div
        style={{
          background:
            "radial-gradient(circle at 20% 20%, rgba(51,112,255,0.10), transparent 28%), radial-gradient(circle at 84% 72%, rgba(0,168,112,0.10), transparent 30%)",
          inset: 0,
          position: "absolute"
        }}
      />
      <div
        style={{
          backgroundImage: `linear-gradient(${colors.line} 1px, transparent 1px), linear-gradient(90deg, ${colors.line} 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          inset: 0,
          opacity: 0.32,
          position: "absolute",
          transform: `translateY(${-move}px)`
        }}
      />
    </AbsoluteFill>
  );
}

function ProgressRail() {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, VIDEO_DURATION_IN_FRAMES - 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        background: colors.mutedSurface,
        height: 6,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        zIndex: 20
      }}
    >
      <div
        style={{
          background: `linear-gradient(90deg, ${colors.brand}, ${colors.success})`,
          height: "100%",
          width: `${progress * 100}%`
        }}
      />
    </div>
  );
}

function FooterBadge({ frame }: { frame: number }) {
  const opacity = interpolate(frame, [20, 50, 1530, 1580], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        alignItems: "center",
        background: "rgba(255,255,255,0.76)",
        border: `1px solid ${colors.line}`,
        borderRadius: 999,
        bottom: 34,
        color: colors.muted,
        display: "flex",
        fontSize: 18,
        fontWeight: 720,
        gap: 12,
        opacity,
        padding: "12px 18px",
        position: "absolute",
        right: 42,
        zIndex: 30
      }}
    >
      <span style={{ background: colors.brand, borderRadius: 999, height: 10, width: 10 }} />
      16:9 product intro / under 1 minute
    </div>
  );
}

function SceneShell({ children, opacity }: { children: React.ReactNode; opacity: number }) {
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        display: "grid",
        gap: 80,
        gridTemplateColumns: "minmax(0, 0.86fr) minmax(0, 1.14fr)",
        opacity,
        padding: "108px 104px 92px"
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function Kicker({ text }: { text: string }) {
  return (
    <div
      style={{
        alignItems: "center",
        color: colors.brandStrong,
        display: "inline-flex",
        fontSize: 22,
        fontWeight: 830,
        gap: 12
      }}
    >
      <span style={{ background: colors.brand, borderRadius: 999, height: 10, width: 10 }} />
      {text}
    </div>
  );
}

function SceneTitle({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const inValue = enter(frame, 4, 38);

  return (
    <h2
      style={{
        color: colors.ink,
        fontSize: 64,
        fontWeight: 850,
        letterSpacing: 0,
        lineHeight: 1.12,
        margin: "24px 0 0",
        opacity: inValue,
        transform: `translateY(${interpolate(inValue, [0, 1], [26, 0])}px)`
      }}
    >
      {children}
    </h2>
  );
}

function SceneSubtitle({ children }: { children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const inValue = enter(frame, 18, 42);

  return (
    <p
      style={{
        color: colors.muted,
        fontSize: 27,
        fontWeight: 500,
        lineHeight: 1.58,
        margin: "28px 0 0",
        opacity: inValue,
        transform: `translateY(${interpolate(inValue, [0, 1], [16, 0])}px)`
      }}
    >
      {children}
    </p>
  );
}

function ProductWindow({ active, children, width = 820 }: { active: string; children: React.ReactNode; width?: number }) {
  const frame = useCurrentFrame();
  const inValue = enter(frame, 0, 42);

  return (
    <div
      style={{
        background: colors.white,
        border: `1px solid ${colors.line}`,
        borderRadius: 24,
        boxShadow: "0 30px 90px rgba(31,35,41,0.12)",
        height: 690,
        overflow: "hidden",
        transform: `translateY(${interpolate(inValue, [0, 1], [38, 0])}px)`,
        width
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", height: "100%" }}>
        <div style={{ background: colors.sidebar, borderRight: `1px solid ${colors.line}`, padding: "26px 18px" }}>
          <div style={{ alignItems: "center", display: "flex", gap: 12, marginBottom: 30 }}>
            <div
              style={{
                background: `linear-gradient(135deg, ${colors.brand}, ${colors.purple})`,
                borderRadius: 12,
                color: colors.white,
                display: "grid",
                fontSize: 22,
                fontWeight: 900,
                height: 42,
                placeItems: "center",
                width: 42
              }}
            >
              M
            </div>
            <div>
              <div style={{ color: colors.tertiary, fontSize: 11, fontWeight: 800 }}>MEETING</div>
              <div style={{ color: colors.ink, fontSize: 18, fontWeight: 820 }}>智能妙记</div>
            </div>
          </div>
          {["主页", "录音 / 导入", "纪要 Review", "设置"].map((item) => (
            <div
              key={item}
              style={{
                background: item === active ? colors.brandSoft : "transparent",
                borderRadius: 10,
                color: item === active ? colors.brand : colors.muted,
                fontSize: 17,
                fontWeight: 760,
                marginBottom: 8,
                padding: "13px 14px"
              }}
            >
              {item}
            </div>
          ))}
        </div>
        <div style={{ padding: 28 }}>
          <div
            style={{
              alignItems: "center",
              borderBottom: `1px solid ${colors.line}`,
              display: "flex",
              justifyContent: "space-between",
              margin: "-28px -28px 26px",
              padding: "20px 28px"
            }}
          >
            <div style={{ color: colors.ink, fontSize: 21, fontWeight: 800 }}>{active}</div>
            <div style={{ background: colors.brand, borderRadius: 9, color: colors.white, fontSize: 15, fontWeight: 800, padding: "10px 14px" }}>
              新建会议
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function DashboardMock() {
  return (
    <div>
      <div style={{ color: colors.ink, fontSize: 32, fontWeight: 850 }}>主页</div>
      <div style={{ color: colors.muted, fontSize: 18, marginTop: 8 }}>集中管理录音转写、纪要、总结长图和发布记录。</div>
      <div style={{ display: "grid", gap: 14, marginTop: 28 }}>
        <DashboardRow title="产品评审会" status="已生成" count="32 段转写 / 8 项行动" />
        <DashboardRow title="客户需求同步" status="待发布" count="18 段转写 / 5 项行动" />
        <DashboardRow title="研发周会" status="录音中" count="实时转写中" />
      </div>
    </div>
  );
}

function DashboardRow({ title, status, count }: { title: string; status: string; count: string }) {
  return (
    <div
      style={{
        alignItems: "center",
        border: `1px solid ${colors.line}`,
        borderRadius: 14,
        display: "grid",
        gridTemplateColumns: "1fr 110px 170px",
        padding: "20px 22px"
      }}
    >
      <div>
        <div style={{ color: colors.ink, fontSize: 22, fontWeight: 800 }}>{title}</div>
        <div style={{ color: colors.tertiary, fontSize: 16, marginTop: 7 }}>{count}</div>
      </div>
      <StatusPill status={status} />
      <div style={{ color: colors.brand, fontSize: 17, fontWeight: 820, textAlign: "right" }}>查看纪要</div>
    </div>
  );
}

function RoutePill({ active = false, label }: { active?: boolean; label: string }) {
  return (
    <div
      style={{
        background: active ? colors.brand : colors.white,
        border: `1px solid ${active ? colors.brand : colors.line}`,
        borderRadius: 999,
        color: active ? colors.white : colors.muted,
        fontSize: 22,
        fontWeight: 800,
        padding: "15px 22px"
      }}
    >
      {label}
    </div>
  );
}

function TranscriptLine({ delay, frame, speaker, text }: { delay: number; frame: number; speaker: string; text: string }) {
  const inValue = enter(frame, delay, 26);
  return (
    <div
      style={{
        background: colors.mutedSurface,
        borderRadius: 12,
        color: colors.ink,
        fontSize: 17,
        lineHeight: 1.45,
        marginTop: 10,
        opacity: inValue,
        padding: "12px 14px",
        transform: `translateY(${interpolate(inValue, [0, 1], [12, 0])}px)`
      }}
    >
      <strong style={{ color: colors.brandStrong }}>{speaker}: </strong>
      {text}
    </div>
  );
}

function ControlCard({ title, value }: { title: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${colors.line}`, borderRadius: 14, minHeight: 92, padding: 18 }}>
      <div style={{ color: colors.tertiary, fontSize: 15, fontWeight: 760 }}>{title}</div>
      <div style={{ color: colors.ink, fontSize: 20, fontWeight: 820, marginTop: 9 }}>{value}</div>
    </div>
  );
}

function MinutesMock({ frame }: { frame: number }) {
  return (
    <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1.1fr 0.9fr" }}>
      <div style={{ border: `1px solid ${colors.line}`, borderRadius: 14, padding: 20 }}>
        <div style={{ color: colors.ink, fontSize: 25, fontWeight: 850 }}>会议纪要</div>
        <MarkdownLine frame={frame} delay={10} text="## 一句话结论" width="76%" />
        <MarkdownLine frame={frame} delay={32} text="Q2 版本应优先压缩会后整理时间。" width="92%" />
        <MarkdownLine frame={frame} delay={54} text="## 关键决策" width="58%" />
        <MarkdownLine frame={frame} delay={76} text="- 保留录音与上传两种入口。" width="84%" />
        <MarkdownLine frame={frame} delay={98} text="- 长图、Word、语雀作为交付出口。" width="96%" />
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        <StructuredCard label="行动项" value="12" color={colors.success} />
        <StructuredCard label="风险卡片" value="4" color={colors.warning} />
        <StructuredCard label="关键决策" value="6" color={colors.brand} />
        <StructuredCard label="章节摘要" value="8" color={colors.purple} />
      </div>
    </div>
  );
}

function MarkdownLine({ delay, frame, text, width }: { delay: number; frame: number; text: string; width: string }) {
  const inValue = enter(frame, delay, 28);
  return (
    <div
      style={{
        background: colors.mutedSurface,
        borderRadius: 9,
        color: colors.muted,
        fontSize: 18,
        fontWeight: text.startsWith("##") ? 850 : 600,
        marginTop: 16,
        opacity: inValue,
        overflow: "hidden",
        padding: "11px 13px",
        width
      }}
    >
      {text}
    </div>
  );
}

function StructuredCard({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${colors.line}`, borderRadius: 14, padding: "18px 20px" }}>
      <div style={{ color: colors.tertiary, fontSize: 16, fontWeight: 760 }}>{label}</div>
      <div style={{ color, fontSize: 42, fontWeight: 900, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function ExportStrip({ frame }: { frame: number }) {
  const items = ["PNG 长图", "Word 报告", "语雀发布"];
  return (
    <div style={{ display: "flex", gap: 14, marginTop: 44 }}>
      {items.map((item, index) => {
        const inValue = enter(frame, 34 + index * 12, 28);
        return (
          <div
            key={item}
            style={{
              background: colors.white,
              border: `1px solid ${colors.line}`,
              borderRadius: 14,
              boxShadow: "0 18px 40px rgba(31,35,41,0.08)",
              color: colors.ink,
              fontSize: 21,
              fontWeight: 820,
              opacity: inValue,
              padding: "17px 20px",
              transform: `translateY(${interpolate(inValue, [0, 1], [18, 0])}px)`
            }}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
}

function VisualReportMock() {
  return (
    <div>
      <div
        style={{
          background: `linear-gradient(135deg, ${colors.brand}, ${colors.purple})`,
          borderRadius: 18,
          color: colors.white,
          padding: "28px 30px"
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 760, opacity: 0.8 }}>会议总结长图</div>
        <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.2, marginTop: 10 }}>Q2 产品评审会</div>
      </div>
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 18 }}>
        <ReportBlock title="核心共识" lines={["优先缩短会后交付时间", "统一纪要、长图和知识库出口"]} />
        <ReportBlock title="关键行动" lines={["本周完成 ASR 配置联调", "下周验证长图模板"]} />
        <ReportBlock title="风险提醒" lines={["长录音需要对象存储承载", "模型输出需保留兜底纪要"]} />
        <ReportBlock title="里程碑" lines={["05/10 内测", "05/20 业务试运行"]} />
      </div>
    </div>
  );
}

function ReportBlock({ lines, title }: { lines: string[]; title: string }) {
  return (
    <div style={{ background: colors.mutedSurface, borderRadius: 16, minHeight: 170, padding: 20 }}>
      <div style={{ color: colors.ink, fontSize: 22, fontWeight: 850 }}>{title}</div>
      {lines.map((line) => (
        <div key={line} style={{ color: colors.muted, fontSize: 17, fontWeight: 620, lineHeight: 1.42, marginTop: 12 }}>
          {line}
        </div>
      ))}
    </div>
  );
}

function FileRow({ delay, frame, meta, status, title }: { delay: number; frame: number; meta: string; status: string; title: string }) {
  const inValue = enter(frame, delay, 32);
  return (
    <div
      style={{
        alignItems: "center",
        border: `1px solid ${colors.line}`,
        borderRadius: 15,
        display: "grid",
        gridTemplateColumns: "1fr 120px 145px",
        opacity: inValue,
        padding: "22px 24px",
        transform: `translateY(${interpolate(inValue, [0, 1], [20, 0])}px)`
      }}
    >
      <div>
        <div style={{ color: colors.ink, fontSize: 24, fontWeight: 850 }}>{title}</div>
        <div style={{ color: colors.tertiary, fontSize: 17, marginTop: 7 }}>{meta}</div>
      </div>
      <StatusPill status={status} />
      <div style={{ color: colors.brand, fontSize: 18, fontWeight: 850, textAlign: "right" }}>查看纪要</div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const isDone = status === "已发布" || status === "已生成";
  return (
    <span
      style={{
        background: isDone ? "#e9f8f2" : colors.brandSoft,
        borderRadius: 999,
        color: isDone ? colors.success : colors.brandStrong,
        display: "inline-block",
        fontSize: 16,
        fontWeight: 820,
        padding: "8px 13px",
        textAlign: "center"
      }}
    >
      {status}
    </span>
  );
}

function SignalIcon({ color, index }: { color: string; index: number }) {
  return (
    <div
      style={{
        alignItems: "center",
        background: `${color}18`,
        borderRadius: 17,
        display: "flex",
        gap: 5,
        height: 58,
        justifyContent: "center",
        width: 58
      }}
    >
      {[0, 1, 2].map((bar) => (
        <span
          key={bar}
          style={{
            background: color,
            borderRadius: 999,
            height: 14 + ((bar + index) % 3) * 9,
            width: 7
          }}
        />
      ))}
    </div>
  );
}

function enter(frame: number, from: number, duration: number) {
  return interpolate(frame, [from, from + duration], [0, 1], {
    easing: easeOut,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
}

function sceneOpacity(frame: number, from: number, duration: number) {
  const fadeIn = interpolate(frame, [from, from + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const fadeOut = interpolate(frame, [duration - 28, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  return Math.min(fadeIn, fadeOut);
}
