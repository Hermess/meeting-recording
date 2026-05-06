import assert from "node:assert/strict";
import test from "node:test";
import { compactTranscriptTexts, createTranscriptDeduper } from "./transcript-dedupe.js";

test("ASR final transcript deduper drops repeated utterance candidates", () => {
  const deduper = createTranscriptDeduper();
  const inputs = [
    "啦啦啦啦啦啦啦啦。",
    "啦啦啦啦啦啦啦啦。",
    "我看大家在吐槽那个古城。",
    "啦啦啦啦啦啦啦啦。",
    "我看大家在吐槽那个古城。",
    "他们说宁宁古城什么呀？"
  ];

  const accepted = inputs.map((text) => deduper.acceptFinal(text)).filter(Boolean);

  assert.deepEqual(accepted, [
    "啦啦啦啦啦啦啦啦。",
    "我看大家在吐槽那个古城。",
    "他们说宁宁古城什么呀？"
  ]);
});

test("ASR final transcript deduper persists only the suffix of cumulative results", () => {
  const deduper = createTranscriptDeduper();
  const accepted = [
    deduper.acceptFinal("青海项目双周会。"),
    deduper.acceptFinal("青海项目双周会。SMS验收偏差需要继续跟进。"),
    deduper.acceptFinal("青海项目双周会。SMS验收偏差需要继续跟进。5月14日前确认技术方案。")
  ].filter(Boolean);

  assert.deepEqual(accepted, [
    "青海项目双周会。",
    "SMS验收偏差需要继续跟进。",
    "5月14日前确认技术方案。"
  ]);
});

test("compactTranscriptTexts removes exact duplicates and cumulative repeats", () => {
  const compacted = compactTranscriptTexts([
    "啦啦啦啦啦啦啦啦。",
    "啦啦啦啦啦啦啦啦。",
    "我看大家在吐槽那个古城。",
    "他们说宁宁古城什么呀？",
    "我看大家在吐槽那个古城。他们说宁宁古城什么呀？",
    "就没什么东西。"
  ]);

  assert.deepEqual(compacted, [
    "啦啦啦啦啦啦啦啦。",
    "我看大家在吐槽那个古城。",
    "他们说宁宁古城什么呀？",
    "就没什么东西。"
  ]);
});
