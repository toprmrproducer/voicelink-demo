import { Router, type Request, type Response } from "express";
import bcrypt from "bcrypt";
import { ObjectId, type WithId } from "mongodb";

import { SignupInput, LoginInput, type Tenant, type User } from "@voiceplatform/shared";

import { getDb } from "../db/connection.js";
import { signAuthToken } from "../lib/jwt.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("auth");
const BCRYPT_COST = 10;

export const authRouter = Router();

function publicUser(user: WithId<User>): Omit<User, "passwordHash"> {
  const { passwordHash: _omit, ...rest } = user;
  return { ...rest, _id: String(user._id) };
}

authRouter.post("/signup", async (req: Request, res: Response) => {
  const parsed = SignupInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }
  const { email, password, tenantId } = parsed.data;
  const users = getDb().collection<User>("users");

  if (await users.findOne({ email })) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  if (tenantId) {
    const tenant = await getDb()
      .collection<Tenant>("tenants")
      .findOne({ _id: tenantId });
    if (!tenant) {
      res.status(400).json({ error: "Unknown tenantId" });
      return;
    }
  }

  const now = new Date();
  const id = new ObjectId().toString();
  const user: User = {
    _id: id,
    tenantId: tenantId ?? null,
    email,
    role: "owner",
    isSuperadmin: false,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    createdAt: now,
    updatedAt: now,
  };
  await users.insertOne(user);

  const token = signAuthToken({
    sub: id,
    tenantId: user.tenantId,
    role: user.role,
    isSuperadmin: user.isSuperadmin,
  });
  log.info({ userId: id, email }, "user signed up");
  res.status(201).json({ token, user: publicUser(user as WithId<User>) });
});

authRouter.post("/login", async (req: Request, res: Response) => {
  const parsed = LoginInput.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;
  const users = getDb().collection<User>("users");
  const user = await users.findOne({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }
  const idStr = String(user._id);
  const token = signAuthToken({
    sub: idStr,
    tenantId: user.tenantId,
    role: user.role,
    isSuperadmin: user.isSuperadmin,
  });
  res.json({ token, user: publicUser(user) });
});

// JWT is stateless — logout is a client concern (drop the token).
// We expose the endpoint so clients have a consistent shape; future work
// adds a server-side revocation list.
authRouter.post("/logout", (_req, res) => {
  res.status(204).end();
});

export const _testHelpers = {
  /** Direct-insert a superadmin user (test fixture). */
  async createSuperadmin(email: string, password: string): Promise<{ id: string; token: string }> {
    const id = new ObjectId().toString();
    await getDb().collection<User>("users").insertOne({
      _id: id,
      tenantId: null,
      email,
      role: "owner",
      isSuperadmin: true,
      passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = signAuthToken({
      sub: id,
      tenantId: null,
      role: "owner",
      isSuperadmin: true,
    });
    return { id, token };
  },
};
