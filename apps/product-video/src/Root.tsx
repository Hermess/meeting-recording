import { Composition } from "remotion";
import { MeetingAiKitIntro, VIDEO_DURATION_IN_FRAMES, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from "./MeetingAiKitIntro";

export const RemotionRoot = () => {
  return (
    <Composition
      id="MeetingAiKitIntro"
      component={MeetingAiKitIntro}
      durationInFrames={VIDEO_DURATION_IN_FRAMES}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
    />
  );
};
