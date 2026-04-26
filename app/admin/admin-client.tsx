"use client";

import { useEffect, useState } from "react";

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  balance: number;
  authorizedAgentIds?: string[];
  createdAt: string;
};

type ManagedAgent = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  type: "video" | "image" | "both";
  visibility: "public" | "private";
  enabled: boolean;
  scenePrompt: string;
  characterPrompt: string;
  languagePrompt: string;
  cameraPrompt: string;
  stylePrompt: string;
  negativePrompt: string;
  extraPrompt: string;
};

type PricingConfig = {
  video_enabled: boolean;
  image_enabled: boolean;
  video_4s: number;
  video_8s: number;
  video_12s: number;
  image_1K: number;
  image_2K: number;
  image_4K: number;
  image2_1K: number;
  image2_2K: number;
  image2_4K: number;
};

const formatMoney = (value: unknown) => Number(value || 0).toFixed(2);

const emptyAgent: ManagedAgent = {
  id: "",
  name: "",
  description: "",
  tags: [],
  type: "both",
  visibility: "public",
  enabled: true,
  scenePrompt: "",
  characterPrompt: "",
  languagePrompt: "",
  cameraPrompt: "",
  stylePrompt: "",
  negativePrompt: "",
  extraPrompt: "",
};

export default function AdminClient() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [agents, setAgents] = useState<ManagedAgent[]>([]);
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [message, setMessage] = useState("");
  const [deltas, setDeltas] = useState<Record<string, string>>({});
  const [editingAgent, setEditingAgent] = useState<ManagedAgent>(emptyAgent);
  const [userSearch, setUserSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [grantUser, setGrantUser] = useState<AdminUser | null>(null);
  const [grantAgentIds, setGrantAgentIds] = useState<string[]>([]);

  const privateAgents = agents.filter((agent) => agent.visibility === "private");
  const filteredUsers = users.filter((user) => {
    const keyword = userSearch.trim().toLowerCase();
    if (!keyword) return true;
    return user.id.toLowerCase().includes(keyword) || user.email.toLowerCase().includes(keyword) || user.name.toLowerCase().includes(keyword);
  });
  const userTotalPages = Math.max(1, Math.ceil(filteredUsers.length / 20));
  const pagedUsers = filteredUsers.slice((userPage - 1) * 20, userPage * 20);

  const loadUsers = async () => {
    const res = await fetch("/api/admin/users", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载用户失败");
      return;
    }
    setUsers(json.data.users);
  };

  const loadAgents = async () => {
    const res = await fetch("/api/admin/agents", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载智能体失败");
      return;
    }
    setAgents(json.data.agents);
  };

  const loadPricing = async () => {
    const res = await fetch("/api/admin/pricing", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "加载价格失败");
      return;
    }
    setPricing(json.data.pricing);
  };

  useEffect(() => {
    void loadUsers();
    void loadAgents();
    void loadPricing();
  }, []);

  const patchUser = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "操作失败");
      return;
    }
    setMessage("操作成功");
    await loadUsers();
  };

  const saveAgent = async () => {
    const isEdit = Boolean(editingAgent.id);
    const res = await fetch(isEdit ? `/api/admin/agents/${editingAgent.id}` : "/api/admin/agents", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editingAgent),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "保存智能体失败");
      return;
    }
    setEditingAgent(emptyAgent);
    setMessage("智能体已保存");
    await loadAgents();
  };

  const deleteAgent = async (id: string) => {
    const res = await fetch(`/api/admin/agents/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "删除智能体失败");
      return;
    }
    setMessage("智能体已删除");
    await loadAgents();
  };

  const savePricing = async () => {
    if (!pricing) return;
    const res = await fetch("/api/admin/pricing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pricing),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "保存价格失败");
      return;
    }
    setPricing(json.data.pricing);
    setMessage("价格已保存");
  };

  const fieldClass = "rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none";
  const agentPromptHints: Record<
    "scenePrompt" | "characterPrompt" | "languagePrompt" | "cameraPrompt" | "stylePrompt" | "negativePrompt" | "extraPrompt",
    string
  > = {
    scenePrompt: "场景提示，描述画面发生的地点、环境和背景",
    characterPrompt: "角色提示，描述人物/主体身份、外观、动作和状态",
    languagePrompt: "语言/对白提示，描述对白语言、语气、口播风格",
    cameraPrompt: "镜头提示，描述机位、景别、运镜和拍摄方式",
    stylePrompt: "风格提示，描述视觉风格、质感、光影和色调",
    negativePrompt: "负面提示，描述不要出现的内容",
    extraPrompt: "补充提示，放置其他额外要求或固定规则",
  };

  return (
    <main className="min-h-screen bg-[#f7f7f8] px-6 py-8 text-black">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">管理员后台</h1>
            <p className="text-sm text-gray-500">用户、智能体与价格配置</p>
          </div>
          <a href="/" className="rounded-full bg-black px-4 py-2 text-sm text-white">返回首页</a>
        </div>
        {message && <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">{message}</div>}

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold">价格配置</h2>
          {pricing && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={pricing.video_enabled} onChange={(event) => setPricing((prev) => prev ? { ...prev, video_enabled: event.target.checked } : prev)} />
                  视频生成开关
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={pricing.image_enabled} onChange={(event) => setPricing((prev) => prev ? { ...prev, image_enabled: event.target.checked } : prev)} />
                  图片生成开关
                </label>
              </div>
              <div className="grid gap-3 md:grid-cols-6">
              {(Object.keys(pricing).filter((key) => typeof pricing[key as keyof PricingConfig] === "number") as (keyof PricingConfig)[]).map((key) => (
                <label key={key} className="space-y-1 text-xs text-gray-500">
                  <span>{key}</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={pricing[key] as number}
                    onChange={(event) => setPricing((prev) => prev ? { ...prev, [key]: Number(event.target.value) } : prev)}
                    className={fieldClass}
                  />
                </label>
              ))}
              <button onClick={() => void savePricing()} className="self-end rounded-xl bg-black px-4 py-2 text-sm text-white">保存价格</button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">智能体管理</h2>
            <button onClick={() => setEditingAgent(emptyAgent)} className="rounded-full bg-gray-100 px-3 py-1.5 text-xs text-gray-700">新建</button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label>
              <input className={fieldClass} placeholder="名称" value={editingAgent.name} onChange={(e) => setEditingAgent((prev) => ({ ...prev, name: e.target.value }))} />
              <div className="mt-1 text-xs text-gray-400">智能体名称，用于前台展示</div>
            </label>
            <label>
              <select className={fieldClass} value={editingAgent.type} onChange={(e) => setEditingAgent((prev) => ({ ...prev, type: e.target.value as ManagedAgent["type"] }))}>
                <option value="video">视频</option>
                <option value="image">图片</option>
                <option value="both">全部</option>
              </select>
              <div className="mt-1 text-xs text-gray-400">适用类型，决定用于视频、图片或全部</div>
            </label>
            <label>
              <select className={fieldClass} value={editingAgent.visibility} onChange={(e) => setEditingAgent((prev) => ({ ...prev, visibility: e.target.value as ManagedAgent["visibility"] }))}>
                <option value="public">公开</option>
                <option value="private">非公开</option>
              </select>
              <div className="mt-1 text-xs text-gray-400">公开状态，公开智能体所有用户可见，非公开需授权</div>
            </label>
            <label className="md:col-span-3">
              <input className={`${fieldClass} w-full`} placeholder="描述" value={editingAgent.description} onChange={(e) => setEditingAgent((prev) => ({ ...prev, description: e.target.value }))} />
              <div className="mt-1 text-xs text-gray-400">智能体简介，用于说明适用场景</div>
            </label>
            <label className="md:col-span-3">
              <input
                className={`${fieldClass} w-full`}
                placeholder="标签，逗号分隔，例如：视频,带货,公开"
                value={editingAgent.tags.join(",")}
                onChange={(e) => setEditingAgent((prev) => ({ ...prev, tags: e.target.value.split(",").map((tag) => tag.trim()).filter(Boolean) }))}
              />
              <div className="mt-1 text-xs text-gray-400">标签名称，用于前台卡片展示，可多个</div>
            </label>
            {(["scenePrompt", "characterPrompt", "languagePrompt", "cameraPrompt", "stylePrompt", "negativePrompt", "extraPrompt"] as const).map((key) => (
              <label key={key}>
                <textarea
                  className={`${fieldClass} min-h-20 w-full`}
                  placeholder={key}
                  value={editingAgent[key]}
                  onChange={(e) => setEditingAgent((prev) => ({ ...prev, [key]: e.target.value }))}
                />
                <div className="mt-1 text-xs text-gray-400">{agentPromptHints[key]}</div>
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editingAgent.enabled} onChange={(e) => setEditingAgent((prev) => ({ ...prev, enabled: e.target.checked }))} />
              <span>
                启用
                <div className="mt-1 text-xs text-gray-400">启用状态，关闭后前台不可使用</div>
              </span>
            </label>
            <button onClick={() => void saveAgent()} className="rounded-xl bg-black px-4 py-2 text-sm text-white">{editingAgent.id ? "保存修改" : "创建智能体"}</button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <div key={agent.id} className="rounded-2xl border border-gray-200 p-4 text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="font-medium">{agent.name}</div>
                  <div className="text-xs text-gray-500">{agent.type} / {agent.visibility} / {agent.enabled ? "启用" : "停用"}</div>
                </div>
                <p className="mb-3 text-xs text-gray-500">{agent.description || "无描述"}</p>
                <div className="mb-3 flex flex-wrap gap-1">
                  {agent.tags.map((tag) => (
                    <span key={`${agent.id}-${tag}`} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{tag}</span>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setEditingAgent(agent)} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">编辑</button>
                  <button onClick={() => void patchAgentQuick(agent.id, { enabled: !agent.enabled })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{agent.enabled ? "停用" : "启用"}</button>
                  <button onClick={() => void patchAgentQuick(agent.id, { visibility: agent.visibility === "public" ? "private" : "public" })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{agent.visibility === "public" ? "设非公开" : "设公开"}</button>
                  <button onClick={() => void deleteAgent(agent.id)} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">删除</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="overflow-x-auto rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <h2 className="text-lg font-semibold">用户管理</h2>
            <input
              value={userSearch}
              onChange={(event) => {
                setUserSearch(event.target.value);
                setUserPage(1);
              }}
              placeholder="搜索 ID / 邮箱 / 昵称"
              className="rounded-full border border-gray-200 bg-gray-50 px-4 py-2 text-sm outline-none"
            />
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">邮箱</th>
                <th className="px-4 py-3">昵称</th>
                <th className="px-4 py-3">角色</th>
                <th className="px-4 py-3">余额</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">授权智能体</th>
                <th className="px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.map((user) => (
                <tr key={user.id} className="border-t border-gray-100 align-top">
                  <td className="px-4 py-3">{user.id}</td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">{user.name}</td>
                  <td className="px-4 py-3">{user.role === "admin" ? "管理员" : "用户"}</td>
                  <td className="px-4 py-3">¥{formatMoney(user.balance)}</td>
                  <td className="px-4 py-3">{user.disabled ? "已禁用" : "正常"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">{(user.authorizedAgentIds ?? []).length} 个已授权</span>
                  </td>
                  <td className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button onClick={() => void patchUser(user.id, { disabled: !user.disabled })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{user.disabled ? "启用" : "禁用"}</button>
                      <button onClick={() => void patchUser(user.id, { role: user.role === "admin" ? "user" : "admin" })} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">{user.role === "admin" ? "取消管理员" : "设为管理员"}</button>
                      <button
                        onClick={() => {
                          setGrantUser(user);
                          setGrantAgentIds(user.authorizedAgentIds ?? []);
                        }}
                        className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
                      >
                        授权智能体
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input value={deltas[user.id] ?? ""} onChange={(event) => setDeltas((prev) => ({ ...prev, [user.id]: event.target.value }))} placeholder="+10 或 -5" className="w-24 rounded-full border border-gray-200 px-3 py-1 text-xs outline-none" />
                      <button
                        onClick={() => {
                          const amount = Number(deltas[user.id]);
                          if (!Number.isFinite(amount) || amount === 0) {
                            setMessage("请输入非 0 金额");
                            return;
                          }
                          void patchUser(user.id, { balanceDelta: amount, reason: "管理员手动调整余额" });
                        }}
                        className="rounded-full bg-black px-3 py-1 text-xs text-white"
                      >
                        调整余额
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4 text-sm text-gray-600">
            <button onClick={() => setUserPage((prev) => Math.max(1, prev - 1))} disabled={userPage <= 1} className="rounded-full bg-gray-100 px-3 py-1 disabled:opacity-40">上一页</button>
            <span>第 {userPage} / {userTotalPages} 页，共 {filteredUsers.length} 个用户</span>
            <button onClick={() => setUserPage((prev) => Math.min(userTotalPages, prev + 1))} disabled={userPage >= userTotalPages} className="rounded-full bg-gray-100 px-3 py-1 disabled:opacity-40">下一页</button>
          </div>
        </section>
      </div>
      {grantUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={() => setGrantUser(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-lg font-semibold">授权智能体</div>
                <div className="text-xs text-gray-500">{grantUser.email} / {grantUser.id}</div>
              </div>
              <button onClick={() => setGrantUser(null)} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700">关闭</button>
            </div>
            <div className="max-h-[52vh] space-y-2 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-3">
              {privateAgents.length === 0 ? (
                <div className="text-sm text-gray-500">暂无 private 智能体</div>
              ) : privateAgents.map((agent) => {
                const checked = grantAgentIds.includes(agent.id);
                return (
                  <label key={agent.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setGrantAgentIds((prev) => checked ? prev.filter((id) => id !== agent.id) : [...prev, agent.id])}
                    />
                    <span>{agent.name}</span>
                  </label>
                );
              })}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setGrantUser(null)} className="rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-700">取消</button>
              <button
                onClick={() => {
                  void patchUser(grantUser.id, { authorizedAgentIds: grantAgentIds });
                  setGrantUser(null);
                }}
                className="rounded-full bg-black px-4 py-2 text-sm text-white"
              >
                保存授权
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );

  async function patchAgentQuick(id: string, body: Partial<ManagedAgent>) {
    const res = await fetch(`/api/admin/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || !json?.success) {
      setMessage(json?.message || "操作智能体失败");
      return;
    }
    await loadAgents();
  }
}
