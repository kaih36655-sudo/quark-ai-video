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
