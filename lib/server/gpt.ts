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
  overallStory: string;
  completeScript: string;
  fullVoiceoverScript: string;
  targetDurationSeconds: number;
  basePrompt: string;
  extensionPrompts: string[];
  stitchPrompts?: string[];
  segmentPlan: Array<{
    segmentIndex: number;
    startSecond: number;
    endSecond: number;
    visualAction: string;
    voiceoverPart: string;
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

const grokMediumVideoFallback = (params: {
  theme: string;
  targetDurationSeconds: number;
  ratio: string;
  agentName?: string;
  agentDescription?: string;
}): GrokMediumVideoPlan => {
  const units = Math.max(1, Math.min(6, Math.ceil(params.targetDurationSeconds / 10)));
  const ratioLabel = params.ratio === "9:16" ? "9:16竖屏" : "16:9横屏";
  const title = params.theme ? params.theme.slice(0, 36) : "Grok 中视频";
  const phaseLabels = units === 1
    ? ["用一个完整 10 秒脚本完成场景、解决和收束"]
    : units === 2
      ? ["提出场景/痛点并留下未完成动作", "承接上一段，展示解决过程和结果收束"]
      : ["提出场景/痛点并留下未完成动作", ...Array.from({ length: units - 2 }, (_, index) => `承接第 ${index + 1} 段，展示解决过程/核心功能的下一步`), "承接上一段，展示结果、总结和行动引导"];
  const fullVoiceoverScript = `完整口播：先点明「${params.theme || "主题"}」里的真实场景和痛点，不急着总结；中段顺着同一个动作展示解决过程、关键功能或核心卖点，只推进下一部分信息；最后才展示结果、总结价值，并给出自然行动引导。`;
  const segmentPlan = phaseLabels.map((summary, index) => ({
    segmentIndex: index + 1,
    startSecond: index * 10,
    endSecond: (index + 1) * 10,
    visualAction:
      index === 0
        ? "画面从第 0 秒立即运动，建立主体、场景和核心冲突"
        : index === units - 1
          ? "承接上一段尾帧动作，完成结果展示和情绪收束"
          : "承接上一段尾帧动作，推进同一个解决过程的下一步",
    voiceoverPart: summary,
    transitionToNext: index === units - 1 ? "最后一段自然收束，不再留下新问题" : "结尾保留未完成动作、未说完的信息或视觉钩子，直接进入下一段",
  }));
  const outline = segmentPlan.map((item) => ({
    segmentIndex: item.segmentIndex,
    start: item.startSecond,
    end: item.endSecond,
    summary: `${item.visualAction}；口播：${item.voiceoverPart}`,
  }));
  const common = `主题：「${params.theme}」。智能体：${params.agentName || "未指定"}。智能体框架：${params.agentDescription || "无"}。画面比例 ${ratioLabel}。不要字幕、水印、Logo。`;
  const basePrompt = `这是 ${params.targetDurationSeconds} 秒 Grok 中视频的第 1/${units} 段，先生成完整脚本的 0-10 秒片段。${common} 一个任务是一条完整视频故事，多段只是技术切分，不要把本段写成独立短视频。完整口播先统一规划：${fullVoiceoverScript} 本段只负责：${segmentPlan[0]?.voiceoverPart || ""}。画面：${segmentPlan[0]?.visualAction || ""}。从第 0 秒立即开始动作，结尾必须留下连续动作/未完成信息，方便下一段承接。参考图只作为首帧参考，立即运动。`;
  const extensionPrompts = outline.slice(1).map((item) =>
    `继续上一段，不要重新介绍，不要重复上一段文案，只推进完整脚本的下一部分。这是同一条 Grok 中视频的第 ${item.segmentIndex}/${units} 段，目标总时长 ${params.targetDurationSeconds} 秒，当前扩展约 10 秒。${common} 必须承接上一段最后画面、动作和上一句口播继续推进，保持主体、服装、场景、光线、镜头语言、色彩风格一致。本段只负责完整脚本的 ${item.start}-${item.end}s：${item.summary}。${item.segmentIndex === units ? "这是最后一段，才允许总结和行动引导。" : "本段结尾继续留下连续动作/叙事钩子给下一段。"}`
  );
  return {
    title,
    overallTitle: title,
    overallStory: `围绕「${params.theme || "主题"}」创作一条完整 ${params.targetDurationSeconds} 秒连续视频，而不是 ${units} 条独立短视频。`,
    completeScript: fullVoiceoverScript,
    fullVoiceoverScript,
    targetDurationSeconds: params.targetDurationSeconds,
    basePrompt,
    extensionPrompts,
    stitchPrompts: [basePrompt, ...extensionPrompts],
    segmentPlan,
    outline,
  };
};

export async function generateGrokMediumVideoPlan(params: {
  theme: string;
  targetDurationSeconds: number;
  ratio: string;
  agentName?: string;
  agentDescription?: string;
}): Promise<GrokMediumVideoPlan> {
  const targetDurationSeconds = [10, 20, 30, 40, 50, 60].includes(params.targetDurationSeconds) ? params.targetDurationSeconds : 10;
  const units = targetDurationSeconds / 10;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return grokMediumVideoFallback({ ...params, targetDurationSeconds });

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
              "你是 Grok 中视频完整叙事脚本策划专家。必须仅返回 JSON。先写一条完整视频故事和完整口播，再切分为每 10 秒一个片段。输出 title, overallTitle, overallStory, completeScript, fullVoiceoverScript, targetDurationSeconds, segmentPlan, basePrompt, extensionPrompts, stitchPrompts, outline。basePrompt 用于第 1 段 create；extensionPrompts 用于第 2 段到第 N 段 extend。禁止把每段写成独立短视频。",
          },
          {
            role: "user",
            content: `用户主题：${params.theme}
智能体名称：${params.agentName || "未指定"}
智能体描述/框架：${params.agentDescription || "无"}
目标总时长：${targetDurationSeconds}秒
10秒单位数：${units}
扩展次数：${units - 1}
画面比例：${ratioLabel}

要求：
1. 第一层先写完整总脚本：overallStory/completeScript/fullVoiceoverScript 必须是一条完整视频故事和完整口播，不是分段独立文案集合。
2. 第二层再切为 ${units} 个 10 秒 segmentPlan。每段只负责完整脚本的一部分，不允许重复介绍同一个卖点，不允许重新开头，不允许每段都像独立短视频。
3. segmentPlan 每项必须包含 segmentIndex, startSecond, endSecond, visualAction, voiceoverPart, transitionToNext。voiceoverPart 必须来自 fullVoiceoverScript 的连续切片，不要为每段单独创作一套完整口播。
4. 第 2 段必须承接第 1 段未完成的信息/动作/口播，第 3 段必须承接第 2 段，最后一段才收束/总结/行动引导。
5. basePrompt 必须写明“第 1/${units} 段”、10秒、目标总时长、${ratioLabel}、不要字幕/水印/Logo，并只生成完整脚本的 0-10 秒部分。
6. extensionPrompts 长度必须是 ${units - 1}，每条都必须包含：“继续上一段，不要重新介绍，不要重复上一段文案，只推进完整脚本的下一部分。”
7. extension prompt 必须承接上一段最后画面、尾帧、动作和上一句口播；保持主体一致、场景连续、动作连续、情绪递进。
8. stitchPrompts 长度必须是 ${units}，每段对应 segmentPlan 的一个区间；每段开头承接上一段尾帧和上一句口播，每段结尾为下一段留下连续动作/叙事钩子，最后一段除外。
9. 所有 prompt 都必须保留：不要字幕，不要水印，不要 Logo；参考图只作为首帧参考，立即运动。`,
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
                overallStory: { type: "string" },
                completeScript: { type: "string" },
                fullVoiceoverScript: { type: "string" },
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
                      visualAction: { type: "string" },
                      voiceoverPart: { type: "string" },
                      transitionToNext: { type: "string" },
                    },
                    required: ["segmentIndex", "startSecond", "endSecond", "visualAction", "voiceoverPart", "transitionToNext"],
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
              required: ["title", "overallTitle", "overallStory", "completeScript", "fullVoiceoverScript", "targetDurationSeconds", "segmentPlan", "basePrompt", "extensionPrompts", "stitchPrompts", "outline"],
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
    if (!parsed.title || !parsed.basePrompt || !Array.isArray(parsed.extensionPrompts) || parsed.extensionPrompts.length !== units - 1 || !Array.isArray(parsed.outline) || parsed.outline.length !== units || !Array.isArray(parsed.segmentPlan) || parsed.segmentPlan.length !== units) {
      return grokMediumVideoFallback({ ...params, targetDurationSeconds });
    }
    const segmentPlan = parsed.segmentPlan.map((item, index) => ({
      segmentIndex: index + 1,
      startSecond: index * 10,
      endSecond: (index + 1) * 10,
      visualAction: typeof item.visualAction === "string" && item.visualAction.trim() ? item.visualAction.trim() : `第 ${index + 1} 段连续画面`,
      voiceoverPart: typeof item.voiceoverPart === "string" && item.voiceoverPart.trim() ? item.voiceoverPart.trim() : `第 ${index + 1} 段口播切片`,
      transitionToNext: typeof item.transitionToNext === "string" && item.transitionToNext.trim() ? item.transitionToNext.trim() : (index === units - 1 ? "自然收束" : "留下连续动作承接下一段"),
    }));
    return {
      title: parsed.title.trim(),
      overallTitle: (parsed.overallTitle || parsed.title).trim(),
      overallStory: (parsed.overallStory || "").trim(),
      completeScript: (parsed.completeScript || "").trim(),
      fullVoiceoverScript: (parsed.fullVoiceoverScript || parsed.completeScript || "").trim(),
      targetDurationSeconds,
      segmentPlan,
      basePrompt: `${parsed.basePrompt.trim()}\n\n硬性要求：这是完整脚本的第 1/${units} 段，只生成 0-10 秒部分；先有完整口播再切片，本段口播只能使用 segmentPlan[1] 的 voiceoverPart；不要把本段写成独立短视频；结尾为下一段留下连续动作/叙事钩子；参考图只作为首帧参考，立即运动；不要字幕、水印、Logo。`,
      extensionPrompts: parsed.extensionPrompts.map((item, index) =>
        `${String(item || "").trim()}\n\n硬性要求：继续上一段，不要重新介绍，不要重复上一段文案，只推进完整脚本的下一部分；这是第 ${index + 2}/${units} 段扩展；目标总时长 ${targetDurationSeconds} 秒；画面比例 ${ratioLabel}；承接上一段最后画面、尾帧、动作和上一句口播继续推进；本段口播只能使用 segmentPlan[${index + 2}] 的 voiceoverPart；不要生成独立短视频；${index + 2 === units ? "这是最后一段，才允许总结/行动引导。" : "结尾为下一段留下连续动作/叙事钩子。"} 不要字幕、水印、Logo。`
      ),
      stitchPrompts: Array.isArray(parsed.stitchPrompts) ? parsed.stitchPrompts.map((item, index) =>
        `${String(item || "").trim()}\n\n硬性要求：这是 Grok 分段拼接模式第 ${index + 1}/${units} 段，对应完整脚本 ${index * 10}-${(index + 1) * 10}s；${index === 0 ? "从第 0 秒立即运动。" : "开头承接上一段尾帧和上一句口播，不要重新介绍。"} 本段只使用对应 voiceoverPart，不要生成一套独立口播；${index === units - 1 ? "最后一段自然收束。" : "结尾为下一段留下连续动作/叙事钩子。"} 不要字幕、水印、Logo。`
      ) : undefined,
      outline: parsed.outline.map((item, index) => ({
        segmentIndex: index + 1,
        start: index * 10,
        end: (index + 1) * 10,
        summary: typeof item.summary === "string" && item.summary.trim() ? item.summary.trim() : `${segmentPlan[index]?.visualAction || ""}；口播：${segmentPlan[index]?.voiceoverPart || ""}`,
      })),
    };
  } catch {
    return grokMediumVideoFallback({ ...params, targetDurationSeconds });
  }
}
