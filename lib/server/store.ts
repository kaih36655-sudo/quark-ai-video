import { Agent, Task, Video } from "./types";
import { loadPersistedStore } from "./persistence";

type InMemoryStore = {
  tasks: Task[];
  videos: Video[];
  agents: Agent[];
  timers: Map<string, ReturnType<typeof setTimeout>>;
  counters: {
    task: number;
    video: number;
  };
};

declare global {
  // eslint-disable-next-line no-var
  var __quark_store__: InMemoryStore | undefined;
}

const defaultAgents: Agent[] = [
  {
    id: "mercari-jp",
    name: "日本煤炉智能体",
    description: "适合 Mercari / 日本跨境电商内容，强调日系平台场景与选品表达。",
    tags: ["煤炉", "Mercari", "跨境电商"],
    accessType: "restricted",
    workflowKey: "mercari_agent_v1",
    status: "active",
    isAuthorized: true,
  },
  {
    id: "xiaohongshu-food",
    name: "小红书餐饮智能体",
    description: "适合探店、种草、门店亮点介绍，偏生活方式和消费体验。",
    tags: ["餐饮", "探店", "种草"],
    accessType: "restricted",
    workflowKey: "xiaohongshu_food_v1",
    status: "active",
    isAuthorized: false,
  },
  {
    id: "video-sales",
    name: "视频带货智能体",
    description: "适合商品卖点拆解、转化型短视频脚本和下单引导场景。",
    tags: ["带货", "转化", "卖点"],
    accessType: "public",
    workflowKey: "sell_video_agent_v1",
    status: "active",
    isAuthorized: true,
  },
  {
    id: "douyin-script",
    name: "抖音口播脚本智能体",
    description: "适合口播节奏、话术结构和短时高信息密度表达。",
    tags: ["抖音", "口播", "脚本"],
    accessType: "restricted",
    workflowKey: "douyin_script_agent_v1",
    status: "active",
    isAuthorized: false,
  },
  {
    id: "ecom-funny",
    name: "电商搞笑短视频智能体",
    description: "适合办公室、电商团队、轻剧情反转的幽默内容。",
    tags: ["搞笑", "电商团队", "剧情反转"],
    accessType: "public",
    workflowKey: "ecommerce_funny_video_v1",
    status: "active",
    isAuthorized: true,
  },
];

export const getStore = (): InMemoryStore => {
  if (!global.__quark_store__) {
    const boot = {
      tasks: [] as Task[],
      videos: [] as Video[],
      counters: {
        task: 1,
        video: 1,
      },
    };
    global.__quark_store__ = {
      tasks: boot.tasks,
      videos: boot.videos,
      agents: defaultAgents,
      timers: new Map(),
      counters: boot.counters,
    };
    void loadPersistedStore().then((saved) => {
      if (!saved || !global.__quark_store__) return;
      global.__quark_store__.tasks = saved.tasks;
      global.__quark_store__.videos = saved.videos;
      global.__quark_store__.counters = saved.counters;
    });
  }
  return global.__quark_store__;
};
