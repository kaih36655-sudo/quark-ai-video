type GenerateVideoScriptParams = {
  theme: string;
  duration?: string;
  agentName?: string;
  agentDescription?: string;
  hasReferenceImage?: boolean;
  referenceImageName?: string;
  index?: number;
};

type GenerateVideoScriptResult = {
  title: string;
  scenes: string[];
  prompt: string;
};

export type MediumVideoSegmentPrompt = {
  segmentIndex: number;
  title: string;
  scenes: string[];
  prompt: string;
};

export type GrokMediumVideoPlan = {
  title: string;
  overallTitle: string;
  userTheme?: string;
  overallStory: string;
  completeScript: string;
  fullVoiceoverScript: string;
  totalSegments?: number;
  targetDurationSeconds: number;
  basePrompt: string;
  extensionPrompts: string[];
  stitchPrompts?: string[];
  segmentPlan: Array<{
    segmentIndex: number;
    startSecond: number;
    endSecond: number;
    storyBeat: string;
    visualAction: string;
    voiceoverPart: string;
    continuityIn: string;
    continuityOut: string;
    mustNotRepeat: string;
    transitionToNext: string;
  }>;
  outline: Array<{
    segmentIndex: number;
    start: number;
    end: number;
    summary: string;
  }>;
};

function getMediumVideoDynamicStartInstruction(params: {
  segmentIndex: number;
  totalSegments: number;
  hasInitialReferenceImage?: boolean;
}) {
  const referenceInstruction =
    params.segmentIndex === 1
      ? params.hasInitialReferenceImage
        ? "参考图仅作为首帧构图与主体一致性参考，禁止将参考图静态展示超过 0.1 秒；第一帧可与参考图一致，但下一瞬间必须立即延续动作。"
        : "即使没有参考图，本段也必须从开头建立连续动作，不要用静态照片式开场。"
      : "以上一段最后关键帧作为连续起点，0.0 秒立即承接上一段动作继续推进，禁止停留展示关键帧。";
  return `动态开场要求：${referenceInstruction} 视频必须从第 0 秒立即出现主体动作、镜头推进、手部操作、环境动态或场景变化；0.0-0.3 秒内必须开始运动；禁止前 1-2 秒静态停留，禁止照片式开场，禁止 freeze frame。The input reference is only a first-frame composition reference. Do not hold it as a still image. No freeze frame. Motion must begin immediately at 0.0s.`;
}

function getMediumVideoDynamicOpeningScene(segmentIndex: number, totalSegments: number) {
  return segmentIndex === 1
    ? `0-1s：画面从第 0 秒立即开始动作或镜头推进，主体不静止停留，建立第 ${segmentIndex}/${totalSegments} 段的连续开场`
    : `0-1s：立即承接上一段最后动作继续推进，不静止展示关键帧，保持第 ${segmentIndex}/${totalSegments} 段连续运动`;
}

const fallback = (params: GenerateVideoScriptParams): GenerateVideoScriptResult => {
  const base = params.theme || "短视频主题";
  const agent = params.agentName ? `，智能体：${params.agentName}` : "";
  const reference = params.hasReferenceImage ? `，参考图：${params.referenceImageName || "已启用"}` : "";
  const seconds = params.duration === "4s" ? 4 : params.duration === "8s" ? 8 : 12;
  const scenes =
    seconds === 4
      ? ["0.3s钩子：一句话抛冲突", "0.3s动作：主体立刻反应", "0.4s镜头：特写关键物", "0.3s信息：给出核心点", "0.3s动作：第二个变化", "0.4s镜头：切到场景", "0.3s台词：短句补充", "0.3s动作：情绪推进", "0.4s镜头：结果显现", "0.3s台词：结论短句", "0.4s动作：收束动作", "0.3s结尾：一口号收尾"]
      : seconds === 8
        ? ["0.4s开场：钩子问题", "0.3s镜头：主体出场", "0.3s动作：第一反应", "0.3s信息：背景一句", "0.4s镜头：场景切换", "0.3s动作：冲突起", "0.3s台词：痛点短句", "0.4s镜头：特写证据", "0.3s动作：应对尝试", "0.3s台词：卖点1", "0.4s镜头：卖点2", "0.3s动作：效果出现", "0.3s台词：利益点", "0.4s镜头：前后对比", "0.3s动作：情绪拉升", "0.3s台词：转折句", "0.4s镜头：关键成果", "0.3s动作：确认结果", "0.3s台词：结论", "0.4s镜头：品牌/人物", "0.3s动作：收尾姿态", "0.3s台词：行动号召", "0.4s结尾：画面定格"]
        : ["2s开场：冲突+人物设定", "2.5s推进：动作与信息递进", "2.5s转折：给出关键变化", "2.5s收束：结果与情绪落点", "2.5s结尾：一句行动引导"];
  return {
    title: `视频${(params.index ?? 0) + 1}：${base}`,
    scenes,
    prompt: `${seconds}秒短视频，镜头快切，单句台词，确保在${seconds}秒内完整表达主题「${base}」${agent}${reference}`,
  };
};

export async function generateVideoScript(params: GenerateVideoScriptParams): Promise<GenerateVideoScriptResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return fallback(params);

  const styleHint = (() => {
    const name = params.agentName || "";
    if (name.includes("煤炉") || name.includes("Mercari")) {
      return "风格偏日本跨境电商：二手平台上新、选品、转化表达，语气专业且实战。";
    }
    if (name.includes("餐饮") || name.includes("小红书")) {
      return "风格偏探店种草：门店氛围、菜品亮点、消费体验与到店引导。";
    }
    if (name.includes("带货")) {
      return "风格偏转化：痛点-卖点-利益点-行动号召，适合商品成交。";
    }
    if (name.includes("口播")) {
      return "风格偏抖音口播：前5秒抓人、节奏快、观点先行。";
    }
    if (name.includes("搞笑")) {
      return "风格偏轻剧情搞笑：冲突-反转-收束，适合电商团队日常。";
    }
    return "风格通用但要有短视频节奏与镜头感。";
  })();

  try {
    const seconds = params.duration === "4s" ? 4 : params.duration === "8s" ? 8 : 12;
    const sceneRule =
      seconds === 4
        ? "必须严格输出 12 个分镜，每个分镜 0.3~0.4 秒，文案极简。"
        : seconds === 8
          ? "必须严格输出 23 个分镜，每个分镜 0.3~0.4 秒，表达完整但短句化。"
          : "必须输出 3~5 个分镜，每个分镜 2~4 秒，叙事完整但不冗长。";
    const schemaMin = seconds === 4 ? 12 : seconds === 8 ? 23 : 3;
    const schemaMax = seconds === 4 ? 12 : seconds === 8 ? 23 : 5;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.6,
        messages: [
          {
            role: "system",
            content:
              `你是短视频脚本策划专家。必须仅返回 JSON，不要任何额外文本。字段严格为：title(string), scenes(string[]), prompt(string)。每个 scenes 元素必须包含“镜头内容+预计时长”，句子必须短，禁止长段落。${sceneRule}`,
          },
          {
            role: "user",
            content: `主题：${params.theme}
视频总时长：${seconds}秒
智能体名称：${params.agentName || "未指定"}
智能体描述：${params.agentDescription || "无"}
是否有参考图：${params.hasReferenceImage ? "是" : "否"}
参考图名称：${params.referenceImageName || "无"}
风格约束：${styleHint}
请输出适用于 Sora/Runway 的视频提示词，要求与${seconds}秒时长匹配，避免超长叙事。`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "video_script",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                scenes: {
                  type: "array",
                  minItems: schemaMin,
                  maxItems: schemaMax,
                  items: { type: "string" },
                },
                prompt: { type: "string" },
              },
              required: ["title", "scenes", "prompt"],
            },
          },
        },
      }),
    });
    clearTimeout(timer);

    if (!response.ok) return fallback(params);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return fallback(params);
    const parsed = JSON.parse(content) as Partial<GenerateVideoScriptResult>;
    if (!parsed.title || !Array.isArray(parsed.scenes) || !parsed.prompt) return fallback(params);
    const cleanedScenes = parsed.scenes
      .filter((scene): scene is string => typeof scene === "string" && scene.trim().length > 0)
      .slice(0, schemaMax);
    if (cleanedScenes.length < schemaMin) return fallback(params);
    return {
      title: parsed.title,
      scenes: cleanedScenes,
      prompt: parsed.prompt,
    };
  } catch {
    return fallback(params);
  }
}

const mediumVideoFallback = (params: {
  theme: string;
  totalSegments: number;
  ratio: string;
  agentName?: string;
  agentDescription?: string;
  hasReferenceImage?: boolean;
}): MediumVideoSegmentPrompt[] => {
  const base = params.theme || "中视频主题";
  const ratioLabel = params.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
  const agent = params.agentName ? `，智能体：${params.agentName}` : "";
  return Array.from({ length: params.totalSegments }, (_, index) => {
    const segmentIndex = index + 1;
    const phase =
      segmentIndex === 1
        ? "开场建立主体、场景和核心冲突，结尾留下明确动作承接下一段"
        : segmentIndex === params.totalSegments
          ? "承接上一段结尾，完成情绪/信息收束，形成完整结尾"
          : "承接上一段结尾，推进一个新动作或新信息，结尾自然转入下一段";
    const title = `中视频片段 ${segmentIndex}/${params.totalSegments}`;
    const scenes = [
      getMediumVideoDynamicOpeningScene(segmentIndex, params.totalSegments),
      `1-4s：承接${segmentIndex === 1 ? "用户主题" : `第${segmentIndex - 1}段结尾`}，主体和画面风格保持一致并持续运动`,
      `4-8s：${phase}`,
      `8-12s：保留连续动作和视觉线索，方便衔接下一段`,
    ];
    const dynamicStartInstruction = getMediumVideoDynamicStartInstruction({
      segmentIndex,
      totalSegments: params.totalSegments,
      hasInitialReferenceImage: params.hasReferenceImage,
    });
    return {
      segmentIndex,
      title,
      scenes,
      prompt: `这是同一条连续中视频的第 ${segmentIndex}/${params.totalSegments} 段，时长 12 秒，画面比例 ${ratioLabel}。主题：「${base}」${agent}。${phase}。${dynamicStartInstruction} 必须保持主体、服装、场景、光线、镜头语言、色彩风格与其他片段连续一致；不要字幕、水印、Logo；不要让本段像独立广告，要像同一条长视频的连续片段。`,
    };
  });
};

export async function generateMediumVideoSegments(params: {
  theme: string;
  totalSegments: number;
  ratio: string;
  agentName?: string;
  agentDescription?: string;
  hasReferenceImage?: boolean;
  referenceImageName?: string;
}): Promise<MediumVideoSegmentPrompt[]> {
  const totalSegments = Math.max(1, Math.min(5, Math.floor(params.totalSegments)));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return mediumVideoFallback({ ...params, totalSegments });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    const ratioLabel = params.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.55,
        messages: [
          {
            role: "system",
            content:
              "你是连续中视频分镜策划专家。必须仅返回 JSON，不要额外文本。输出 segments 数组，每个元素字段严格为 segmentIndex(number), title(string), scenes(string[]), prompt(string)。所有片段必须像同一条长视频的连续片段，主体、场景、风格、镜头语言连续一致。若使用 input_reference，参考图只能作为首帧构图参考，视频必须从 0.0 秒立即运动，禁止静态停留或 freeze frame。",
          },
          {
            role: "user",
            content: `用户主题：${params.theme}
智能体名称：${params.agentName || "未指定"}
智能体描述：${params.agentDescription || "无"}
总片段数：${totalSegments}
总时长：${totalSegments * 12}秒
单段时长：12秒
画面比例：${ratioLabel}
是否有首段参考图：${params.hasReferenceImage ? "是" : "否"}
参考图名称：${params.referenceImageName || "无"}

请生成 ${totalSegments} 个连续 Sora2 视频提示词。要求：
1. 每段必须明确“第 X/${totalSegments} 段”、12秒、${ratioLabel}。
2. 主体、服装、场景、光线、镜头语言、色彩风格在所有片段中保持一致。
3. 上一段结尾必须能自然衔接下一段开头。
4. 不要字幕、水印、Logo。
5. 不要把每段写成独立广告，要像同一条长视频的连续剧情/连续展示。
6. 每段 scenes 输出 3-5 条，包含时间段和镜头内容。
7. 动态开场要求必须写入每段 prompt：如果本段有 input_reference，参考图只作为第一帧构图与主体一致性参考，禁止静态展示参考图，禁止照片式开场，禁止 freeze frame，视频从第 0 秒立即出现主体动作、镜头推进、手部操作、主体运动或环境动态，0.0-0.3 秒内必须开始运动。
8. 第 1 段如有用户参考图：写明“参考图仅作为第一帧视觉参考，视频开头不允许静态展示参考图，画面从第 0 秒立即开始动作。”
9. 第 2 段及后续片段：写明“以上一段最后关键帧作为连续起点，0.0 秒立即承接上一段动作继续推进，不要停留展示关键帧。”
10. scenes 不要写“0-2s 展示主体”这类静态描述，首条必须类似“0-1s 镜头立即推进/主体立即开始动作/手部继续操作”。`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "medium_video_segments",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                segments: {
                  type: "array",
                  minItems: totalSegments,
                  maxItems: totalSegments,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      segmentIndex: { type: "number" },
                      title: { type: "string" },
                      scenes: {
                        type: "array",
                        minItems: 3,
                        maxItems: 5,
                        items: { type: "string" },
                      },
                      prompt: { type: "string" },
                    },
                    required: ["segmentIndex", "title", "scenes", "prompt"],
                  },
                },
              },
              required: ["segments"],
            },
          },
        },
      }),
    });
    clearTimeout(timer);
    if (!response.ok) return mediumVideoFallback({ ...params, totalSegments });
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") return mediumVideoFallback({ ...params, totalSegments });
    const parsed = JSON.parse(content) as { segments?: Partial<MediumVideoSegmentPrompt>[] };
    if (!Array.isArray(parsed.segments) || parsed.segments.length !== totalSegments) return mediumVideoFallback({ ...params, totalSegments });
    const cleaned = parsed.segments.map((segment, index) => {
      const segmentIndex = index + 1;
      const originalScenes = Array.isArray(segment.scenes)
        ? segment.scenes.filter((scene): scene is string => typeof scene === "string" && scene.trim().length > 0)
        : [];
      return {
        segmentIndex,
        title: typeof segment.title === "string" && segment.title.trim() ? segment.title.trim() : `中视频片段 ${segmentIndex}/${totalSegments}`,
        scenes: [getMediumVideoDynamicOpeningScene(segmentIndex, totalSegments), ...originalScenes].slice(0, 5),
        prompt: typeof segment.prompt === "string" && segment.prompt.trim() ? segment.prompt.trim() : "",
      };
    });
    if (cleaned.some((segment) => segment.scenes.length < 3 || !segment.prompt)) return mediumVideoFallback({ ...params, totalSegments });
    return cleaned.map((segment) => ({
      ...segment,
      prompt: `${segment.prompt}\n\n硬性要求：这是同一条连续中视频的第 ${segment.segmentIndex}/${totalSegments} 段；单段时长 12 秒；画面比例 ${ratioLabel}；${getMediumVideoDynamicStartInstruction({
        segmentIndex: segment.segmentIndex,
        totalSegments,
        hasInitialReferenceImage: params.hasReferenceImage,
      })} 不要字幕、水印、Logo；保持主体、场景、风格与其他片段连续一致。`,
    }));
  } catch {
    return mediumVideoFallback({ ...params, totalSegments });
  }
}

const AGENT_PROMPT_FIELD_PATTERN =
  /(?:^|\n)\s*(?:场景提示|人物提示|语言\/对白提示|语言提示|对白提示|机位\/镜头提示|机位提示|镜头提示|风格提示|补充提示|负面提示|用户输入|scenePrompt|characterPrompt|languagePrompt|cameraPrompt|stylePrompt|extraPrompt|negativePrompt|userInput)\s*[:：]/im;

const truncateUtf8Text = (value: string, maxBytes: number) => {
  let result = "";
  let bytes = 0;
  for (const char of Array.from(value)) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (bytes + charBytes > maxBytes) break;
    result += char;
    bytes += charBytes;
  }
  return result.trim();
};

type NormalizedAgentConstraintParts = {
  positive: string;
  negative: string;
};

const RAW_AGENT_PROMPT_FIELD_PATTERN =
  /(场景提示|人物提示|语言\/对白提示|语言提示|对白提示|机位\/镜头提示|机位提示|镜头提示|风格提示|补充提示|负面提示|用户输入|scenePrompt|characterPrompt|languagePrompt|cameraPrompt|stylePrompt|extraPrompt|negativePrompt|userInput|User input)\s*[:：]/i;

const STRICT_NORMALIZED_AGENT_CONSTRAINT_SECTION_PATTERN =
  /(?:^|[。\n；;])\s*(正向约束|负面约束)\s*[:：]\s*([\s\S]*?)(?=(?:[。\n；;]\s*(?:正向约束|负面约束)\s*[:：])|$)/g;

const hasNegativeIntent = (value: string) => /(不要|避免|禁止|不允许|不能|不得|无字幕|无水印|无Logo|无LOGO|no\s+)/i.test(value);

const normalizeConstraintText = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[，。；、\s]+$/g, "");

const normalizeNegativeConstraintText = (value: string) => {
  const normalized = normalizeConstraintText(value);
  if (!normalized) return "";
  return hasNegativeIntent(normalized) ? normalized : `避免出现：${normalized}`;
};

const parseStrictNormalizedGrokAgentConstraints = (value: string): NormalizedAgentConstraintParts | null => {
  const source = value.trim();
  if (!source) return null;
  if (RAW_AGENT_PROMPT_FIELD_PATTERN.test(source)) return null;
  if (!/^\s*(正向约束|负面约束)\s*[:：]/.test(source)) return null;

  const matches = Array.from(source.matchAll(STRICT_NORMALIZED_AGENT_CONSTRAINT_SECTION_PATTERN));
  if (!matches.length) return null;

  const remainder = source
    .replace(STRICT_NORMALIZED_AGENT_CONSTRAINT_SECTION_PATTERN, "")
    .replace(/[。\n；;\s]/g, "");
  if (remainder) return null;

  let positive = "";
  let negative = "";
  matches.forEach((match) => {
    const label = match[1];
    const content = normalizeConstraintText(match[2] || "");
    if (!content) return;
    if (label === "正向约束" && !positive) positive = content;
    if (label === "负面约束" && !negative) negative = normalizeNegativeConstraintText(content);
  });

  if (!positive && !negative) return null;
  return { positive, negative };
};

const normalizeStrictAgentConstraints = (parts: NormalizedAgentConstraintParts) =>
  [
    parts.positive ? `正向约束：${parts.positive}` : "",
    parts.negative ? `负面约束：${parts.negative}` : "",
  ]
    .filter(Boolean)
    .join("。");

const extractGrokAgentConstraints = (promptSnapshot?: string, agentDescription?: string) => {
  const source = [promptSnapshot, agentDescription].filter(Boolean).join("\n");
  if (!source.trim()) return "";
  type AgentPromptField = "positive" | "negative" | "userInput" | null;
  const fieldTitlePattern =
    /(场景提示|人物提示|语言\/对白提示|语言提示|对白提示|机位\/镜头提示|机位提示|镜头提示|风格提示|补充提示|负面提示|negativePrompt|Negative prompt|用户输入|userInput|User input)\s*[:：]/g;
  const fieldLinePattern =
    /^(场景提示|人物提示|语言\/对白提示|语言提示|对白提示|机位\/镜头提示|机位提示|镜头提示|风格提示|补充提示|负面提示|negativePrompt|Negative prompt|用户输入|userInput|User input)\s*[:：]\s*(.*)$/;
  const normalizedParts = parseStrictNormalizedGrokAgentConstraints(source);
  if (normalizedParts) return normalizeStrictAgentConstraints(normalizedParts);
  const pushUniqueConstraint = (items: string[], value: string) => {
    const normalized = normalizeConstraintText(value);
    if (!normalized) return;
    if (!items.some((item) => normalizeConstraintText(item) === normalized)) items.push(normalized);
  };
  const normalizedSource = source.replace(
    fieldTitlePattern,
    "\n$1："
  );
  const positiveConstraints: string[] = [];
  const negativeConstraints: string[] = [];
  let currentField: AgentPromptField = null;
  normalizedSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const fieldMatch = fieldLinePattern.exec(line);
      if (fieldMatch) {
        const label = fieldMatch[1];
        const content = fieldMatch[2].replace(/\s+/g, " ").trim();
        if (/^(用户输入|userInput|User input)$/.test(label)) {
          currentField = "userInput";
          return;
        }
        if (/^(负面提示|negativePrompt|Negative prompt)$/.test(label)) {
          currentField = "negative";
          if (content) pushUniqueConstraint(negativeConstraints, normalizeNegativeConstraintText(content));
          return;
        }
        currentField = "positive";
        if (content) pushUniqueConstraint(positiveConstraints, content);
        return;
      }
      if (currentField === "userInput") return;
      const content = line.replace(/\s+/g, " ").trim();
      if (currentField === "negative") {
        if (content) pushUniqueConstraint(negativeConstraints, normalizeNegativeConstraintText(content));
        return;
      }
      if (currentField === "positive" && content) pushUniqueConstraint(positiveConstraints, content);
    });
  const sections = [
    positiveConstraints.length ? `正向约束：${positiveConstraints.join("；")}` : "",
    negativeConstraints.length ? `负面约束：${negativeConstraints.join("；")}` : "",
  ].filter(Boolean);
  return truncateUtf8Text(sections.join("。"), 900);
};

const normalizeGrokAgentConstraints = (agentConstraints?: string, agentDescription?: string) => {
  const value = agentConstraints?.trim();
  if (value) {
    const normalizedParts = parseStrictNormalizedGrokAgentConstraints(value);
    if (normalizedParts) return normalizeStrictAgentConstraints(normalizedParts);
  }
  return extractGrokAgentConstraints(value, agentDescription);
};

const textSimilarity = (a: string, b: string) => {
  const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
  const makeGrams = (value: string) => {
    const source = normalize(value);
    const grams = new Set<string>();
    if (source.length <= 3) {
      if (source) grams.add(source);
      return grams;
    }
    for (let index = 0; index <= source.length - 3; index += 1) {
      grams.add(source.slice(index, index + 3));
    }
    return grams;
  };
  const left = makeGrams(a);
  const right = makeGrams(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  left.forEach((gram) => {
    if (right.has(gram)) intersection += 1;
  });
  return intersection / Math.max(left.size, right.size);
};

const validateGrokSegmentPlan = (plan: Pick<GrokMediumVideoPlan, "segmentPlan">, totalSegments: number) => {
  if (plan.segmentPlan.length !== totalSegments) {
    return { ok: false, reason: "segmentPlan length mismatch", segmentIndex: 0 };
  }
  const restartPattern = /(开场|首先|今天给大家介绍|这个视频展示|本视频开始|重新介绍|再次展示|从头开始)/;
  const continuityPattern = /(承接|继续|推进|上一段|接着|随后|延续|尾帧|上一句|下一步)/;
  for (let index = 0; index < plan.segmentPlan.length; index += 1) {
    const segment = plan.segmentPlan[index];
    const segmentIndex = index + 1;
    if (!segment.voiceoverPart?.trim()) return { ok: false, reason: "voiceoverPart empty", segmentIndex };
    if (!segment.visualAction?.trim()) return { ok: false, reason: "visualAction empty", segmentIndex };
    if (!segment.storyBeat?.trim()) return { ok: false, reason: "storyBeat empty", segmentIndex };
    const storyContent = `${segment.storyBeat}\n${segment.visualAction}\n${segment.voiceoverPart}`;
    if (AGENT_PROMPT_FIELD_PATTERN.test(storyContent)) return { ok: false, reason: "agent_prompt_leaked_into_story", segmentIndex };
    if (index > 0) {
      const generatedContent = `${segment.storyBeat} ${segment.visualAction} ${segment.voiceoverPart} ${segment.continuityIn || ""} ${segment.continuityOut || ""}`;
      if (restartPattern.test(generatedContent)) return { ok: false, reason: "segment restarts story", segmentIndex };
      if (!continuityPattern.test(generatedContent)) return { ok: false, reason: "segment lacks continuity", segmentIndex };
      const previous = plan.segmentPlan[index - 1];
      if (textSimilarity(previous.voiceoverPart, segment.voiceoverPart) > 0.72) return { ok: false, reason: "voiceoverPart too similar", segmentIndex };
      if (textSimilarity(previous.visualAction, segment.visualAction) > 0.72) return { ok: false, reason: "visualAction too similar", segmentIndex };
    }
  }
  return { ok: true, reason: "", segmentIndex: 0 };
};

const logGrokPlanValidation = (stage: "PLAN_VALIDATION_FAILED" | "PLAN_VALIDATION_SUCCESS", payload: Record<string, unknown>) => {
  console.log(`[GROK_VIDEO][${stage}]`, JSON.stringify(payload));
};

const buildGrokSegmentPrompt = (params: {
  theme: string;
  targetDurationSeconds: number;
  ratioLabel: string;
  totalSegments: number;
  segment: GrokMediumVideoPlan["segmentPlan"][number];
  agentName?: string;
  agentDescription?: string;
  agentConstraints?: string;
  mode: "base" | "extend" | "stitch";
}) => {
  const isFirst = params.segment.segmentIndex === 1;
  const isLast = params.segment.segmentIndex === params.totalSegments;
  const agentLine = params.agentName ? `智能体：${params.agentName}。` : "";
  const agentConstraints = normalizeGrokAgentConstraints(params.agentConstraints, params.agentDescription);
  const styleLine = agentConstraints ? `智能体约束：${agentConstraints}。` : "";
  const referenceLine =
    params.mode === "stitch" && !isFirst
      ? "输入参考图是上一段视频的最后可用非黑帧，请从该状态继续，0.0秒立即延续上一帧动作。"
      : params.mode === "extend" && !isFirst
        ? "这是扩展生成，请承接上一段最后画面、动作和上一句口播继续推进。"
        : "从第0秒立即建立动作起点，不要静态展示首帧。";
  return `全片主题：${params.theme || "用户主题"}
当前段：第 ${params.segment.segmentIndex}/${params.totalSegments} 段，${params.segment.startSecond}-${params.segment.endSecond}s，目标总时长 ${params.targetDurationSeconds} 秒，画面比例 ${params.ratioLabel}。
当前段任务：只推进完整故事的当前部分，不能把本段写成完整独立短视频。
storyBeat：${params.segment.storyBeat}
visualAction：${params.segment.visualAction}
voiceoverPart：${params.segment.voiceoverPart}
continuityIn：${params.segment.continuityIn}
continuityOut：${params.segment.continuityOut}
mustNotRepeat：${params.segment.mustNotRepeat}
连续性要求：${referenceLine} ${isFirst ? "只做开场/起因/铺垫，不要提前讲完结果。" : "不要重新开头，不要重新介绍主题，不要重复上一段画面或口播。"} ${isLast ? "这是最后一段，才允许总结、收束或行动引导。" : "本段结尾必须留下可承接的动作、情绪或信息。"}
${agentLine}${styleLine}
基础约束：真实连续视频镜头，主体、场景、动作、情绪和口播必须连续；无字幕、水印、Logo。`;
};

const buildGrokPromptsFromSegmentPlan = (params: {
  theme: string;
  targetDurationSeconds: number;
  ratioLabel: string;
  totalSegments: number;
  segmentPlan: GrokMediumVideoPlan["segmentPlan"];
  agentName?: string;
  agentDescription?: string;
  agentConstraints?: string;
}) => {
  const prompts = params.segmentPlan.map((segment) =>
    buildGrokSegmentPrompt({ ...params, segment, mode: "stitch" })
  );
  return {
    basePrompt: buildGrokSegmentPrompt({ ...params, segment: params.segmentPlan[0], mode: "base" }),
    extensionPrompts: params.segmentPlan.slice(1).map((segment) =>
      buildGrokSegmentPrompt({ ...params, segment, mode: "extend" })
    ),
    stitchPrompts: prompts,
  };
};

const grokMediumVideoFallback = (params: {
  theme: string;
  targetDurationSeconds: number;
  ratio: string;
  agentName?: string;
  agentDescription?: string;
  agentConstraints?: string;
}): GrokMediumVideoPlan => {
  const units = Math.max(1, Math.min(6, Math.ceil(params.targetDurationSeconds / 10)));
  const ratioLabel = params.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
  const title = params.theme ? params.theme.slice(0, 36) : "Grok 中视频";
  const theme = params.theme || "用户主题";
  const storyBeats = Array.from({ length: units }, (_, index) => {
    if (units === 1) return "完整呈现主题的起因、关键动作和结果收束";
    if (index === 0) return "场景建立，提出起因/痛点/冲突，只完成铺垫";
    if (index === units - 1) return "承接上一段，展示结果/反转/收束和自然行动引导";
    if (index === units - 2 && units >= 4) return "承接上一段，进入高潮或关键结果出现前的决定性动作";
    return `承接第 ${index} 段，推进解决过程/行动变化/核心信息的第 ${index + 1} 步`;
  });
  const fullVoiceoverParts = storyBeats.map((beat, index) => {
    if (units === 1) return `围绕「${theme}」快速建立场景，展示关键动作，并自然落到结果。`;
    if (index === 0) return `在真实场景中呈现「${theme}」的开端，只提出问题和起因，留出后续推进空间。`;
    if (index === units - 1) return `接着上一段的变化，展示最终结果或反转，再给出简短总结和行动引导。`;
    return `继续上一段未完成的信息，展示第 ${index + 1} 步推进，让变化更具体，但不重复开头介绍。`;
  });
  const fullVoiceoverScript = fullVoiceoverParts.map((part, index) => `第${index + 1}段：${part}`).join(" ");
  const segmentPlan = storyBeats.map((storyBeat, index) => ({
    segmentIndex: index + 1,
    startSecond: index * 10,
    endSecond: (index + 1) * 10,
    storyBeat,
    visualAction:
      index === 0
        ? "画面从第 0 秒立即运动，建立主体、场景和核心冲突，只铺垫不收束"
        : index === units - 1
          ? "承接上一段尾帧动作，完成结果展示和情绪收束"
          : `承接上一段尾帧动作，推进同一个解决过程的第 ${index + 1} 步`,
    voiceoverPart: fullVoiceoverParts[index],
    continuityIn: index === 0 ? "无，完整故事开头" : `承接第 ${index} 段最后画面、动作和上一句口播`,
    continuityOut: index === units - 1 ? "最后一段自然收束，不再留下新问题" : `留给第 ${index + 2} 段的未完成动作、情绪或信息`,
    mustNotRepeat: index === 0 ? "不要提前讲后续解决和最终结果" : `不要重复第 ${index} 段的开头介绍、画面动作和口播`,
    transitionToNext: index === units - 1 ? "最后一段自然收束，不再留下新问题" : "结尾保留未完成动作、未说完的信息或视觉钩子，直接进入下一段",
  }));
  const outline = segmentPlan.map((item) => ({
    segmentIndex: item.segmentIndex,
    start: item.startSecond,
    end: item.endSecond,
    summary: `${item.visualAction}；口播：${item.voiceoverPart}`,
  }));
  const prompts = buildGrokPromptsFromSegmentPlan({
    theme,
    targetDurationSeconds: params.targetDurationSeconds,
    ratioLabel,
    totalSegments: units,
    segmentPlan,
    agentName: params.agentName,
    agentDescription: params.agentDescription,
    agentConstraints: params.agentConstraints,
  });
  return {
    title,
    userTheme: theme,
    overallTitle: title,
    overallStory: `围绕「${theme}」创作一条完整 ${params.targetDurationSeconds} 秒连续视频：先建立起因，再逐步推进，最后收束，而不是 ${units} 条独立短视频。`,
    completeScript: fullVoiceoverScript,
    fullVoiceoverScript,
    totalSegments: units,
    targetDurationSeconds: params.targetDurationSeconds,
    basePrompt: prompts.basePrompt,
    extensionPrompts: prompts.extensionPrompts,
    stitchPrompts: prompts.stitchPrompts,
    segmentPlan,
    outline,
  };
};

export async function generateGrokMediumVideoPlan(params: {
  taskId?: string;
  theme: string;
  targetDurationSeconds: number;
  ratio: string;
  agentName?: string;
  agentDescription?: string;
  agentConstraints?: string;
}): Promise<GrokMediumVideoPlan> {
  const targetDurationSeconds = [10, 20, 30, 40, 50, 60].includes(params.targetDurationSeconds) ? params.targetDurationSeconds : 10;
  const units = targetDurationSeconds / 10;
  const userTheme = params.theme?.trim() || "用户主题";
  const agentConstraints = normalizeGrokAgentConstraints(params.agentConstraints, params.agentDescription);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return grokMediumVideoFallback({ ...params, targetDurationSeconds });

  try {
    const ratioLabel = params.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
    for (let planAttempt = 1; planAttempt <= 2; planAttempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.55,
        messages: [
          {
            role: "system",
            content:
              "你是 Grok 中视频完整叙事脚本策划专家。必须仅返回 JSON。先写一条完整视频故事和完整口播，再切分为每 10 秒一个片段。segmentPlan 是唯一权威：每段必须是完整故事的不同切片，不能把每段写成独立短视频。第2段及以后必须承接上一段，不得重新介绍主题。",
          },
          {
            role: "user",
            content: `用户主题：${userTheme}
智能体名称：${params.agentName || "未指定"}
智能体约束（只作为场景、人物、风格、镜头和限制参考，禁止进入剧情正文或口播）：${agentConstraints || "无"}
目标总时长：${targetDurationSeconds}秒
10秒单位数：${units}
扩展次数：${units - 1}
画面比例：${ratioLabel}

要求：
1. 第一层先写完整总脚本：overallStory/completeScript/fullVoiceoverScript 必须是一条完整视频故事和完整口播，不是分段独立文案集合。
2. 第二层再切为 ${units} 个 10 秒 segmentPlan。每段只负责完整脚本的一部分，不允许重复介绍同一个卖点，不允许重新开头，不允许每段都像独立短视频。
3. segmentPlan 每项必须包含 segmentIndex, startSecond, endSecond, storyBeat, visualAction, voiceoverPart, continuityIn, continuityOut, mustNotRepeat, transitionToNext。
4. voiceoverPart 必须来自 fullVoiceoverScript 的连续切片，不要为每段单独创作一套完整口播；相邻段 voiceoverPart 和 visualAction 必须明显不同。
5. 第 1 段只负责场景建立、起因、痛点或冲突，不要提前讲结果。
6. 第 2 段及以后必须承接上一段最后画面/动作/上一句口播，不能出现“今天给大家介绍/这个视频展示/本视频开始/重新介绍/再次展示/从头开始”。
7. 只有最后一段可以总结、收束或行动引导。
8. basePrompt/extensionPrompts/stitchPrompts 可以简短，但不要塞完整故事全文；最终 provider prompt 会由 segmentPlan 生成。
9. 所有 prompt 都必须保留：不要字幕，不要水印，不要 Logo；参考图只作为首帧参考，立即运动。
10. 绝对禁止在 storyBeat、visualAction、voiceoverPart、fullVoiceoverScript 中出现或朗读这些内部字段名：场景提示、人物提示、语言/对白提示、机位/镜头提示、风格提示、补充提示、负面提示、用户输入。
11. 智能体约束只能影响场景和风格，不能覆盖用户主题，不能成为口播内容。
${planAttempt > 1 ? "注意：上一版 segmentPlan 被判定相邻片段重复或缺少连续性，这次必须让每段 storyBeat/visualAction/voiceoverPart 明显不同。" : ""}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "grok_medium_video_plan",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string" },
                overallTitle: { type: "string" },
                userTheme: { type: "string" },
                overallStory: { type: "string" },
                completeScript: { type: "string" },
                fullVoiceoverScript: { type: "string" },
                totalSegments: { type: "number" },
                targetDurationSeconds: { type: "number" },
                segmentPlan: {
                  type: "array",
                  minItems: units,
                  maxItems: units,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      segmentIndex: { type: "number" },
                      startSecond: { type: "number" },
                      endSecond: { type: "number" },
                      storyBeat: { type: "string" },
                      visualAction: { type: "string" },
                      voiceoverPart: { type: "string" },
                      continuityIn: { type: "string" },
                      continuityOut: { type: "string" },
                      mustNotRepeat: { type: "string" },
                      transitionToNext: { type: "string" },
                    },
                    required: ["segmentIndex", "startSecond", "endSecond", "storyBeat", "visualAction", "voiceoverPart", "continuityIn", "continuityOut", "mustNotRepeat", "transitionToNext"],
                  },
                },
                basePrompt: { type: "string" },
                extensionPrompts: {
                  type: "array",
                  minItems: units - 1,
                  maxItems: units - 1,
                  items: { type: "string" },
                },
                stitchPrompts: {
                  type: "array",
                  minItems: units,
                  maxItems: units,
                  items: { type: "string" },
                },
                outline: {
                  type: "array",
                  minItems: units,
                  maxItems: units,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      segmentIndex: { type: "number" },
                      start: { type: "number" },
                      end: { type: "number" },
                      summary: { type: "string" },
                    },
                    required: ["segmentIndex", "start", "end", "summary"],
                  },
                },
              },
              required: ["title", "overallTitle", "userTheme", "overallStory", "completeScript", "fullVoiceoverScript", "totalSegments", "targetDurationSeconds", "segmentPlan", "basePrompt", "extensionPrompts", "stitchPrompts", "outline"],
            },
          },
        },
      }),
    });
      clearTimeout(timer);
      if (!response.ok) return grokMediumVideoFallback({ ...params, targetDurationSeconds });
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") return grokMediumVideoFallback({ ...params, targetDurationSeconds });
      const parsed = JSON.parse(content) as Partial<GrokMediumVideoPlan>;
      if (!parsed.title || !Array.isArray(parsed.outline) || parsed.outline.length !== units || !Array.isArray(parsed.segmentPlan) || parsed.segmentPlan.length !== units) {
        return grokMediumVideoFallback({ ...params, targetDurationSeconds });
      }
      const segmentPlan = parsed.segmentPlan.map((item, index) => ({
        segmentIndex: index + 1,
        startSecond: index * 10,
        endSecond: (index + 1) * 10,
        storyBeat: typeof item.storyBeat === "string" && item.storyBeat.trim() ? item.storyBeat.trim() : `完整故事第 ${index + 1} 部分`,
        visualAction: typeof item.visualAction === "string" && item.visualAction.trim() ? item.visualAction.trim() : `第 ${index + 1} 段连续画面`,
        voiceoverPart: typeof item.voiceoverPart === "string" && item.voiceoverPart.trim() ? item.voiceoverPart.trim() : `第 ${index + 1} 段口播切片`,
        continuityIn: typeof item.continuityIn === "string" && item.continuityIn.trim() ? item.continuityIn.trim() : (index === 0 ? "无，完整故事开头" : `承接第 ${index} 段最后画面和上一句口播`),
        continuityOut: typeof item.continuityOut === "string" && item.continuityOut.trim() ? item.continuityOut.trim() : (index === units - 1 ? "最后一段自然收束" : `留给第 ${index + 2} 段继续推进`),
        mustNotRepeat: typeof item.mustNotRepeat === "string" && item.mustNotRepeat.trim() ? item.mustNotRepeat.trim() : (index === 0 ? "不要提前讲后续解决和最终结果" : `不要重复第 ${index} 段开头介绍`),
        transitionToNext: typeof item.transitionToNext === "string" && item.transitionToNext.trim() ? item.transitionToNext.trim() : (index === units - 1 ? "自然收束" : "留下连续动作承接下一段"),
      }));
      const validation = validateGrokSegmentPlan({ segmentPlan }, units);
      if (!validation.ok) {
        logGrokPlanValidation("PLAN_VALIDATION_FAILED", {
          taskId: params.taskId || "",
          reason: validation.reason,
          segmentIndex: validation.segmentIndex,
          attempt: planAttempt,
        });
        if (planAttempt < 2) continue;
        return grokMediumVideoFallback({ ...params, targetDurationSeconds });
      }
      logGrokPlanValidation("PLAN_VALIDATION_SUCCESS", {
        taskId: params.taskId || "",
        totalSegments: units,
        attempt: planAttempt,
      });
      const prompts = buildGrokPromptsFromSegmentPlan({
        theme: userTheme || parsed.userTheme || "用户主题",
        targetDurationSeconds,
        ratioLabel,
        totalSegments: units,
        segmentPlan,
        agentName: params.agentName,
        agentDescription: params.agentDescription,
        agentConstraints,
      });
      return {
        title: parsed.title.trim(),
        userTheme: userTheme || parsed.userTheme || "",
        overallTitle: (parsed.overallTitle || parsed.title).trim(),
        overallStory: (parsed.overallStory || "").trim(),
        completeScript: (parsed.completeScript || "").trim(),
        fullVoiceoverScript: (parsed.fullVoiceoverScript || parsed.completeScript || segmentPlan.map((item) => item.voiceoverPart).join(" ")).trim(),
        totalSegments: units,
        targetDurationSeconds,
        segmentPlan,
        basePrompt: prompts.basePrompt,
        extensionPrompts: prompts.extensionPrompts,
        stitchPrompts: prompts.stitchPrompts,
        outline: parsed.outline.map((item, index) => ({
          segmentIndex: index + 1,
          start: index * 10,
          end: (index + 1) * 10,
          summary: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : `${segmentPlan[index]?.storyBeat || ""}；${segmentPlan[index]?.visualAction || ""}；口播：${segmentPlan[index]?.voiceoverPart || ""}`,
        })),
      };
    }
    return grokMediumVideoFallback({ ...params, targetDurationSeconds });
  } catch {
    return grokMediumVideoFallback({ ...params, targetDurationSeconds });
  }
}
