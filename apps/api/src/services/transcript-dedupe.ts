export type TranscriptDeduper = {
  acceptFinal(text: string): string | null;
  hasAcceptedText(): boolean;
};

export function createTranscriptDeduper(seedTexts: string[] = []): TranscriptDeduper {
  const seenNormalized = new Set<string>();
  let aggregateText = "";
  let aggregateNormalized = "";

  function remember(text: string) {
    const cleaned = cleanTranscriptText(text);
    const normalized = normalizeTranscriptText(cleaned);
    if (!normalized) {
      return;
    }
    seenNormalized.add(normalized);
    aggregateText = aggregateText ? `${aggregateText}\n${cleaned}` : cleaned;
    aggregateNormalized += normalized;
  }

  for (const seedText of seedTexts) {
    remember(seedText);
  }

  return {
    acceptFinal(rawText: string) {
      const text = cleanTranscriptText(rawText);
      const normalized = normalizeTranscriptText(text);
      if (!normalized) {
        return null;
      }
      if (seenNormalized.has(normalized) || aggregateNormalized.includes(normalized)) {
        return null;
      }

      if (aggregateNormalized && normalized.startsWith(aggregateNormalized)) {
        const suffix = cleanTranscriptText(stripLeadingContinuationPunctuation(sliceRawSuffixByNormalizedPrefix(text, aggregateNormalized)));
        const suffixNormalized = normalizeTranscriptText(suffix);
        if (!suffixNormalized || seenNormalized.has(suffixNormalized) || aggregateNormalized.includes(suffixNormalized)) {
          aggregateText = text;
          aggregateNormalized = normalized;
          seenNormalized.add(normalized);
          return null;
        }
        aggregateText = text;
        aggregateNormalized = normalized;
        seenNormalized.add(normalized);
        seenNormalized.add(suffixNormalized);
        return suffix;
      }

      remember(text);
      return text;
    },
    hasAcceptedText() {
      return aggregateNormalized.length > 0;
    }
  };
}

export function compactTranscriptTexts(texts: string[]) {
  const deduper = createTranscriptDeduper();
  const compacted: string[] = [];
  for (const text of texts) {
    const accepted = deduper.acceptFinal(text);
    if (accepted) {
      compacted.push(accepted);
    }
  }
  return compacted;
}

export function cleanTranscriptText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeTranscriptText(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，,。.!！?？；;：:、"'“”‘’（）()[\]{}《》<>【】\-—_~`·…]/g, "");
}

function sliceRawSuffixByNormalizedPrefix(text: string, normalizedPrefix: string) {
  if (!normalizedPrefix) {
    return text;
  }

  let consumed = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const normalizedChar = normalizeTranscriptText(char);
    consumed += normalizedChar.length;
    if (consumed >= normalizedPrefix.length) {
      return text.slice(index + 1);
    }
  }
  return "";
}

function stripLeadingContinuationPunctuation(text: string) {
  return text.replace(/^[\s，,。.!！?？；;：:、]+/, "");
}
