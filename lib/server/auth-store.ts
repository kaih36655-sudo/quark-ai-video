import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export type AppUser = {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: "user" | "admin";
  disabled: boolean;
  balance: number;
  createdAt: string;
  updatedAt: string;
};

export type BalanceLog = {
  id: string;
  userId: string;
  amount: number;
  reason: string;
  operatorUserId: string;
  createdAt: string;
};

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const BALANCE_LOGS_FILE = path.join(DATA_DIR, "balance-logs.json");
const SESSION_COOKIE = "quark_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const publicUser = (user: AppUser) => {
  const { passwordHash, ...safe } = user;
  return safe;
};

export type PublicUser = ReturnType<typeof publicUser>;

const hashPassword = (password: string, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.pbkdf2Sync(password, salt, 120_000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$${salt}$${hash}`;
};

const verifyPassword = (password: string, passwordHash: string) => {
  const [, salt, stored] = passwordHash.split("$");
  if (!salt || !stored) return false;
  const hash = hashPassword(password, salt).split("$")[2];
  if (hash.length !== stored.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(stored));
};

const sessionSecret = () => process.env.AUTH_SESSION_SECRET || process.env.NEXTAUTH_SECRET || "quark-ai-video-dev-session-secret";

const signSession = (userId: string, issuedAt: number) => {
  return crypto.createHmac("sha256", sessionSecret()).update(`${userId}.${issuedAt}`).digest("hex");
};

export const createSessionCookie = (userId: string) => {
  const issuedAt = Date.now();
  return `${userId}.${issuedAt}.${signSession(userId, issuedAt)}`;
};

export const parseSessionCookie = (value?: string | null) => {
  if (!value) return null;
  const [userId, issuedAtRaw, signature] = value.split(".");
  const issuedAt = Number(issuedAtRaw);
  if (!userId || !Number.isFinite(issuedAt) || !signature) return null;
  if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;
  const expected = signSession(userId, issuedAt);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return userId;
};

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

export const sessionCookieName = SESSION_COOKIE;

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const text = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(filePath: string, rows: T[]) {
  await ensureDataDir();
  await writeFile(filePath, JSON.stringify(rows, null, 2), "utf-8");
}

async function ensureInitialAdmin(users: AppUser[]) {
  if (users.length > 0) return users;
  const now = new Date().toISOString();
  const email = (process.env.INIT_ADMIN_EMAIL || "admin@quark.local").toLowerCase();
  const password = process.env.INIT_ADMIN_PASSWORD || "admin123456";
  const admin: AppUser = {
    id: "u_1",
    email,
    passwordHash: hashPassword(password),
    name: "管理员",
    role: "admin",
    disabled: false,
    balance: 100,
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonArray(USERS_FILE, [admin]);
  return [admin];
}

export async function listUsers() {
  const users = await ensureInitialAdmin(await readJsonArray<AppUser>(USERS_FILE));
  return users;
}

export async function getUserById(id: string) {
  const users = await listUsers();
  return users.find((user) => user.id === id) ?? null;
}

export async function getUserByEmail(email: string) {
  const users = await listUsers();
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) ?? null;
}

export async function createUser(payload: { email: string; password: string; name?: string }) {
  const users = await listUsers();
  const email = payload.email.trim().toLowerCase();
  if (users.some((user) => user.email.toLowerCase() === email)) {
    throw new Error("邮箱已注册");
  }
  const now = new Date().toISOString();
  const maxId = users.reduce((max, user) => Math.max(max, Number(user.id.replace(/^u_/, "")) || 0), 0);
  const user: AppUser = {
    id: `u_${maxId + 1}`,
    email,
    passwordHash: hashPassword(payload.password),
    name: payload.name?.trim() || email.split("@")[0],
    role: "user",
    disabled: false,
    balance: 0,
    createdAt: now,
    updatedAt: now,
  };
  await writeJsonArray(USERS_FILE, [user, ...users]);
  return user;
}

export async function authenticateUser(email: string, password: string) {
  const user = await getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  if (user.disabled) {
    throw new Error("账号已被禁用");
  }
  return user;
}

export async function updateUser(id: string, patch: Partial<Pick<AppUser, "role" | "disabled" | "balance" | "name">>) {
  const users = await listUsers();
  const index = users.findIndex((user) => user.id === id);
  if (index < 0) return null;
  const next: AppUser = {
    ...users[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  users[index] = next;
  await writeJsonArray(USERS_FILE, users);
  return next;
}

export async function addBalanceLog(payload: Omit<BalanceLog, "id" | "createdAt">) {
  const logs = await readJsonArray<BalanceLog>(BALANCE_LOGS_FILE);
  const now = new Date().toISOString();
  const log: BalanceLog = {
    ...payload,
    id: `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
  };
  await writeJsonArray(BALANCE_LOGS_FILE, [log, ...logs]);
  return log;
}

export async function adjustUserBalance(params: {
  userId: string;
  amount: number;
  reason: string;
  operatorUserId: string;
}) {
  const user = await getUserById(params.userId);
  if (!user) throw new Error("用户不存在");
  const nextBalance = Number((user.balance + params.amount).toFixed(2));
  if (nextBalance < 0) throw new Error("余额不足，不能扣成负数");
  const nextUser = await updateUser(user.id, { balance: nextBalance });
  await addBalanceLog({
    userId: user.id,
    amount: params.amount,
    reason: params.reason,
    operatorUserId: params.operatorUserId,
  });
  return nextUser!;
}

export const toPublicUser = publicUser;
