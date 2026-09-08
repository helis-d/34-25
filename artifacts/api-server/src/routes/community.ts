import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  comments,
  db,
  media,
  posts,
  reports,
  sessions,
  users,
  votes,
} from "@workspace/db";
import {
  CreateCommentBody,
  CreateCommentParams,
  CreatePostBody,
  CreateReportBody,
  CreatePostResponse,
  GetCommentsParams,
  GetCommentsResponse,
  GetCurrentUserResponse,
  GetFeedQueryParams,
  GetFeedResponse,
  GetPostParams,
  GetPostResponse,
  GetProfileParams,
  GetProfileResponse,
  LogInBody,
  LogInResponse,
  LogOutResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  SearchQueryParams,
  SearchResponse,
  SignUpBody,
  SignUpResponse,
  UpdateCommentBody,
  UpdateCommentParams,
  UpdatePostBody,
  UpdatePostParams,
  VoteOnCommentParams,
  VoteOnCommentResponse,
  VoteOnPostParams,
  VoteOnPostResponse,
} from "@workspace/api-zod";
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ObjectStorageService } from "../lib/objectStorage";

const scrypt = promisify(scryptCallback);
const router: IRouter = Router();
const SESSION_DAYS = 30;
const objectStorageService = new ObjectStorageService();

function getCookie(req: Request, key: string) {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`));
  return cookie ? decodeURIComponent(cookie.slice(key.length + 1)) : undefined;
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(scope: string, max: number, windowMs = 60_000) {
  return (req: Request, res: Response, next: () => void) => {
    const key = `${scope}:${req.ip ?? "unknown"}`;
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || current.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (current.count >= max) {
      res.status(429).json({ error: "Too many requests. Try again shortly." });
      return;
    }
    current.count += 1;
    next();
  };
}

function setSessionCookie(res: Response, id: string) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader(
    "Set-Cookie",
    `sid=${encodeURIComponent(id)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function clearSessionCookie(res: Response) {
  res.setHeader("Set-Cookie", "sid=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
}

function publicUser(user: typeof users.$inferSelect, karma = 0) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    createdAt: user.createdAt,
    karma,
  };
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

async function getSessionUser(req: Request) {
  const sessionId = getCookie(req, "sid");
  if (!sessionId) return undefined;
  const result = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionId), sql`${sessions.expiresAt} > now()`))
    .limit(1);
  return result[0]?.user;
}

async function requireUser(req: Request, res: Response) {
  const user = await getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in is required." });
    return undefined;
  }
  return user;
}

function postType(type: string): "discuss" | "ask" | "show" {
  return type === "ask" || type === "show" ? type : "discuss";
}

async function voteState(userId: string | undefined, postIds: string[], commentIds: string[]) {
  if (!userId || (postIds.length === 0 && commentIds.length === 0)) return new Set<string>();
  const rows = await db
    .select({ postId: votes.postId, commentId: votes.commentId })
    .from(votes)
    .where(
      and(
        eq(votes.userId, userId),
        or(
          postIds.length ? inArray(votes.postId, postIds) : sql`false`,
          commentIds.length ? inArray(votes.commentId, commentIds) : sql`false`,
        ),
      ),
    );
  return new Set(rows.map((row) => row.postId ?? row.commentId ?? ""));
}

async function commentCount(postId: string) {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.postId, postId), eq(comments.deleted, false)));
  return result[0]?.count ?? 0;
}

async function serializePost(
  post: typeof posts.$inferSelect,
  author: typeof users.$inferSelect,
  userId?: string,
) {
  const [count, voted, attachedMedia] = await Promise.all([
    commentCount(post.id),
    voteState(userId, [post.id], []),
    db.select().from(media).where(eq(media.postId, post.id)).limit(1),
  ]);
  return {
    id: post.id,
    type: postType(post.type),
    title: post.title,
    author: { id: author.id, username: author.username },
    score: post.score,
    commentCount: count,
    createdAt: post.createdAt,
    userVoted: voted.has(post.id),
    url: post.url,
    content: post.content,
    updatedAt: post.updatedAt,
    media: attachedMedia[0]
      ? {
          path: attachedMedia[0].objectPath,
          contentType: attachedMedia[0].contentType,
          altText: attachedMedia[0].altText,
          width: attachedMedia[0].width,
          height: attachedMedia[0].height,
        }
      : null,
  };
}

async function serializeComments(postId: string, userId?: string) {
  const rows = await db
    .select({ comment: comments, author: users })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.postId, postId))
    .orderBy(asc(comments.createdAt));
  const voted = await voteState(
    userId,
    [],
    rows.map(({ comment }) => comment.id),
  );
  const depths = new Map<string, number>();
  return rows.map(({ comment, author }) => {
    const depth = comment.parentId ? Math.min((depths.get(comment.parentId) ?? 0) + 1, 8) : 0;
    depths.set(comment.id, depth);
    return {
      id: comment.id,
      content: comment.deleted ? "[deleted]" : comment.content,
      author: { id: author.id, username: comment.deleted ? "[deleted]" : author.username },
      score: comment.score,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      deleted: comment.deleted,
      depth,
      userVoted: voted.has(comment.id),
    };
  });
}

router.get("/auth/me", async (req, res) => {
  const user = await getSessionUser(req);
  const data = GetCurrentUserResponse.parse({
    user: user ? publicUser(user) : null,
  });
  res.json(data);
});

router.post("/auth/signup", rateLimit("signup", 8), async (req, res) => {
  const input = SignUpBody.parse(req.body);
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.username, input.username), eq(users.email, input.email.toLowerCase())))
    .limit(1);
  if (existing.length) {
    res.status(400).json({ error: "That username or email is already in use." });
    return;
  }
  const user = {
    id: randomUUID(),
    username: input.username,
    email: input.email.toLowerCase(),
    passwordHash: await hashPassword(input.password),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(users).values(user);
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  setSessionCookie(res, sessionId);
  res.status(201).json(SignUpResponse.parse({ user: publicUser(user) }));
});

router.post("/auth/login", rateLimit("login", 12), async (req, res) => {
  const input = LogInBody.parse(req.body);
  const result = await db.select().from(users).where(eq(users.email, input.email.toLowerCase())).limit(1);
  const user = result[0];
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  const sessionId = randomUUID();
  await db.insert(sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
  });
  setSessionCookie(res, sessionId);
  res.json(LogInResponse.parse({ user: publicUser(user) }));
});

router.post("/auth/logout", async (req, res) => {
  const sessionId = getCookie(req, "sid");
  if (sessionId) await db.delete(sessions).where(eq(sessions.id, sessionId));
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/feed", async (req, res) => {
  const query = GetFeedQueryParams.parse(req.query);
  const offset = (query.page - 1) * query.pageSize;
  const filters = [eq(posts.deleted, false)];
  if (query.section === "ask" || query.section === "show") filters.push(eq(posts.type, query.section));
  const order = query.section === "top" ? [desc(posts.score), desc(posts.createdAt)] : [desc(posts.createdAt)];
  const rows = await db
    .select({
      post: posts,
      authorId: users.id,
      authorUsername: users.username,
      commentCount: sql<number>`count(${comments.id})::int`,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(comments, and(eq(comments.postId, posts.id), eq(comments.deleted, false)))
    .where(and(...filters))
    .groupBy(posts.id, users.id, users.username)
    .orderBy(...order)
    .limit(query.pageSize + 1)
    .offset(offset);
  const currentUser = await getSessionUser(req);
  const items = rows.slice(0, query.pageSize);
  const voted = await voteState(
    currentUser?.id,
    items.map(({ post }) => post.id),
    [],
  );
  const data = GetFeedResponse.parse({
    items: items.map(({ post, authorId, authorUsername, commentCount: count }) => ({
      id: post.id,
      type: postType(post.type),
      title: post.title,
      author: { id: authorId, username: authorUsername },
      score: post.score,
      commentCount: count,
      createdAt: post.createdAt,
      userVoted: voted.has(post.id),
      url: post.url,
    })),
    page: query.page,
    pageSize: query.pageSize,
    hasMore: rows.length > query.pageSize,
  });
  res.json(data);
});

router.post("/posts", rateLimit("create-post", 10, 60 * 60_000), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const input = CreatePostBody.parse(req.body);
  const now = new Date();
  const post = {
    id: randomUUID(),
    authorId: user.id,
    type: input.type,
    title: input.title.trim(),
    content: input.content,
    url: input.url || null,
    score: 0,
    deleted: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(posts).values(post);
  if (input.mediaPath) {
    await db.insert(media).values({
      id: randomUUID(),
      postId: post.id,
      objectPath: input.mediaPath,
      contentType: "image/*",
      fileSize: 0,
      altText: "",
    });
  }
  const data = await serializePost(post, user, user.id);
  res.status(201).json(CreatePostResponse.parse(data));
});

router.get("/posts/:postId", async (req, res) => {
  const { postId } = GetPostParams.parse(req.params);
  const currentUser = await getSessionUser(req);
  const row = await db
    .select({ post: posts, author: users })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(eq(posts.id, postId), eq(posts.deleted, false)))
    .limit(1);
  if (!row[0]) {
    res.status(404).json({ error: "Post not found." });
    return;
  }
  const post = await serializePost(row[0].post, row[0].author, currentUser?.id);
  const data = GetPostResponse.parse({
    ...post,
    comments: await serializeComments(postId, currentUser?.id),
  });
  res.json(data);
});

router.patch("/posts/:postId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { postId } = UpdatePostParams.parse(req.params);
  const input = UpdatePostBody.parse(req.body);
  const existing = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  if (!existing[0] || existing[0].authorId !== user.id || existing[0].deleted) {
    res.status(404).json({ error: "Post not found." });
    return;
  }
  const [updated] = await db
    .update(posts)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.url !== undefined ? { url: input.url || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning();
  res.json(await serializePost(updated, user, user.id));
});

router.delete("/posts/:postId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { postId } = GetPostParams.parse(req.params);
  const result = await db
    .update(posts)
    .set({ deleted: true, updatedAt: new Date(), content: "[deleted]" })
    .where(and(eq(posts.id, postId), eq(posts.authorId, user.id), eq(posts.deleted, false)))
    .returning({ id: posts.id });
  if (!result.length) {
    res.status(404).json({ error: "Post not found." });
    return;
  }
  res.status(204).end();
});

router.post("/posts/:postId/vote", rateLimit("vote-post", 120), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { postId } = VoteOnPostParams.parse(req.params);
  const existing = await db
    .select()
    .from(votes)
    .where(and(eq(votes.userId, user.id), eq(votes.postId, postId)))
    .limit(1);
  let voted = false;
  if (existing[0]) {
    await db.delete(votes).where(eq(votes.id, existing[0].id));
    await db.update(posts).set({ score: sql`${posts.score} - 1` }).where(eq(posts.id, postId));
  } else {
    await db.insert(votes).values({ id: randomUUID(), userId: user.id, postId });
    await db.update(posts).set({ score: sql`${posts.score} + 1` }).where(eq(posts.id, postId));
    voted = true;
  }
  const [post] = await db.select({ score: posts.score }).from(posts).where(eq(posts.id, postId));
  res.json(VoteOnPostResponse.parse({ voted, score: post?.score ?? 0 }));
});

router.get("/posts/:postId/comments", async (req, res) => {
  const { postId } = GetCommentsParams.parse(req.params);
  const currentUser = await getSessionUser(req);
  res.json(GetCommentsResponse.parse(await serializeComments(postId, currentUser?.id)));
});

router.post("/posts/:postId/comments", rateLimit("create-comment", 30, 60 * 60_000), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { postId } = CreateCommentParams.parse(req.params);
  const input = CreateCommentBody.parse(req.body);
  const comment = {
    id: randomUUID(),
    postId,
    authorId: user.id,
    parentId: input.parentId || null,
    content: input.content,
    score: 0,
    deleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.insert(comments).values(comment);
  const serialized = await serializeComments(postId, user.id);
  const created = serialized.find((item) => item.id === comment.id);
  res.status(201).json(created);
});

router.patch("/comments/:commentId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { commentId } = UpdateCommentParams.parse(req.params);
  const input = UpdateCommentBody.parse(req.body);
  const [updated] = await db
    .update(comments)
    .set({ content: input.content, updatedAt: new Date() })
    .where(and(eq(comments.id, commentId), eq(comments.authorId, user.id), eq(comments.deleted, false)))
    .returning({ postId: comments.postId });
  if (!updated) {
    res.status(404).json({ error: "Comment not found." });
    return;
  }
  const serialized = await serializeComments(updated.postId, user.id);
  res.json(serialized.find((item) => item.id === commentId));
});

router.delete("/comments/:commentId", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { commentId } = UpdateCommentParams.parse(req.params);
  const result = await db
    .update(comments)
    .set({ deleted: true, content: "[deleted]", updatedAt: new Date() })
    .where(and(eq(comments.id, commentId), eq(comments.authorId, user.id), eq(comments.deleted, false)))
    .returning({ id: comments.id });
  if (!result.length) {
    res.status(404).json({ error: "Comment not found." });
    return;
  }
  res.status(204).end();
});

router.post("/comments/:commentId/vote", rateLimit("vote-comment", 120), async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const { commentId } = VoteOnCommentParams.parse(req.params);
  const existing = await db
    .select()
    .from(votes)
    .where(and(eq(votes.userId, user.id), eq(votes.commentId, commentId)))
    .limit(1);
  let voted = false;
  if (existing[0]) {
    await db.delete(votes).where(eq(votes.id, existing[0].id));
    await db.update(comments).set({ score: sql`${comments.score} - 1` }).where(eq(comments.id, commentId));
  } else {
    await db.insert(votes).values({ id: randomUUID(), userId: user.id, commentId });
    await db.update(comments).set({ score: sql`${comments.score} + 1` }).where(eq(comments.id, commentId));
    voted = true;
  }
  const [comment] = await db.select({ score: comments.score }).from(comments).where(eq(comments.id, commentId));
  res.json(VoteOnCommentResponse.parse({ voted, score: comment?.score ?? 0 }));
});

router.get("/profiles/:username", async (req, res) => {
  const { username } = GetProfileParams.parse(req.params);
  const user = (await db.select().from(users).where(eq(users.username, username)).limit(1))[0];
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }
  const userPosts = await db
    .select({ post: posts, authorId: users.id, authorUsername: users.username })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .where(and(eq(posts.authorId, user.id), eq(posts.deleted, false)))
    .orderBy(desc(posts.createdAt))
    .limit(50);
  const userComments = await db
    .select({ comment: comments, authorId: users.id, authorUsername: users.username })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .where(eq(comments.authorId, user.id))
    .orderBy(desc(comments.createdAt))
    .limit(50);
  const [postCount] = await db.select({ count: sql<number>`count(*)::int` }).from(posts).where(and(eq(posts.authorId, user.id), eq(posts.deleted, false)));
  const [commentCount] = await db.select({ count: sql<number>`count(*)::int` }).from(comments).where(and(eq(comments.authorId, user.id), eq(comments.deleted, false)));
  const [karma] = await db
    .select({ total: sql<number>`coalesce(sum(${posts.score}), 0)::int` })
    .from(posts)
    .where(eq(posts.authorId, user.id));
  const currentUser = await getSessionUser(req);
  const data = GetProfileResponse.parse({
    user: publicUser(user, karma?.total ?? 0),
    postCount: postCount?.count ?? 0,
    commentCount: commentCount?.count ?? 0,
    karma: karma?.total ?? 0,
    posts: await Promise.all(userPosts.map(({ post, authorId, authorUsername }) => serializePost(post, { ...user, id: authorId, username: authorUsername }, currentUser?.id))),
    comments: await serializeCommentsForProfile(userComments),
  });
  res.json(data);
});

async function serializeCommentsForProfile(
  rows: Array<{ comment: typeof comments.$inferSelect; authorId: string; authorUsername: string }>,
) {
  const voted = await voteState(undefined, [], rows.map(({ comment }) => comment.id));
  return rows.map(({ comment, authorId, authorUsername }) => ({
    id: comment.id,
    content: comment.deleted ? "[deleted]" : comment.content,
    author: { id: authorId, username: comment.deleted ? "[deleted]" : authorUsername },
    score: comment.score,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    deleted: comment.deleted,
    depth: 0,
    userVoted: voted.has(comment.id),
  }));
}

router.get("/search", async (req, res) => {
  const { q } = SearchQueryParams.parse(req.query);
  const pattern = `%${q}%`;
  const rows = await db
    .select({
      post: posts,
      authorId: users.id,
      authorUsername: users.username,
      commentCount: sql<number>`count(${comments.id})::int`,
    })
    .from(posts)
    .innerJoin(users, eq(posts.authorId, users.id))
    .leftJoin(comments, and(eq(comments.postId, posts.id), eq(comments.deleted, false)))
    .where(
      and(
        eq(posts.deleted, false),
        or(
          sql`to_tsvector('simple', coalesce(${posts.title}, '') || ' ' || coalesce(${posts.content}, '')) @@ plainto_tsquery('simple', ${q})`,
          ilike(users.username, pattern),
        ),
      ),
    )
    .groupBy(posts.id, users.id, users.username)
    .orderBy(desc(posts.createdAt))
    .limit(50);
  res.json(
    SearchResponse.parse(
      rows.map(({ post, authorId, authorUsername, commentCount }) => ({
        id: post.id,
        type: postType(post.type),
        title: post.title,
        author: { id: authorId, username: authorUsername },
        score: post.score,
        commentCount,
        createdAt: post.createdAt,
        userVoted: false,
        url: post.url,
      })),
    ),
  );
});

router.post("/reports", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const input = CreateReportBody.parse(req.body);
  await db.insert(reports).values({
    id: randomUUID(),
    reporterId: user.id,
    targetType: input.targetType,
    targetId: input.targetId,
    reason: input.reason,
    details: input.details || null,
  });
  res.status(201).end();
});

router.post("/storage/uploads/request-url", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const input = RequestUploadUrlBody.parse(req.body);
  const maxSize = input.contentType === "image/gif" ? 15 * 1024 * 1024 : 10 * 1024 * 1024;
  if (input.size > maxSize) {
    res.status(400).json({ error: "That file is too large." });
    return;
  }
  try {
    const uploadUrl = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadUrl);
    res.json(
      RequestUploadUrlResponse.parse({
        uploadUrl,
        objectPath,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating media upload URL");
    res.status(500).json({ error: "Could not prepare media upload." });
  }
});

void seedDemoData();

async function seedDemoData() {
  if (process.env.NODE_ENV === "production") return;
  const existing = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((existing[0]?.count ?? 0) > 0) return;
  const passwordHash = await hashPassword("demo-password");
  const demoUsers = [
    { id: randomUUID(), username: "archelaus", email: "archelaus@3425.local", passwordHash },
    { id: randomUUID(), username: "user123", email: "user123@3425.local", passwordHash },
    { id: randomUUID(), username: "mira", email: "mira@3425.local", passwordHash },
  ];
  await db.insert(users).values(demoUsers);
  const seededPosts = [
    {
      id: randomUUID(),
      authorId: demoUsers[0].id,
      type: "discuss" as const,
      title: "Why are modern websites becoming so heavy?",
      content: "A page should feel like a document first. Where did we lose the plot?",
      score: 184,
    },
    {
      id: randomUUID(),
      authorId: demoUsers[1].id,
      type: "show" as const,
      title: "SHOW: I built a tiny game engine",
      content: "A weekend experiment in TypeScript, canvas, and deterministic updates.",
      score: 127,
    },
    {
      id: randomUUID(),
      authorId: demoUsers[2].id,
      type: "ask" as const,
      title: "What is the best way to learn systems programming?",
      content: "Looking for books and projects that teach fundamentals without hand-waving.",
      score: 91,
    },
    {
      id: randomUUID(),
      authorId: demoUsers[0].id,
      type: "discuss" as const,
      title: "The quiet return of personal software",
      content: "Small tools built for a few people can still be the most satisfying products.",
      score: 76,
    },
    {
      id: randomUUID(),
      authorId: demoUsers[1].id,
      type: "show" as const,
      title: "SHOW: A terminal UI for tracking reading notes",
      content: "Local-first, plain text files, and a deliberately boring interface.",
      score: 64,
    },
  ];
  await db.insert(posts).values(seededPosts);
  await db.insert(comments).values([
    {
      id: randomUUID(),
      postId: seededPosts[0].id,
      authorId: demoUsers[1].id,
      content: "The amount of JavaScript shipped for a button is a useful benchmark.",
      score: 32,
    },
    {
      id: randomUUID(),
      postId: seededPosts[0].id,
      authorId: demoUsers[2].id,
      content: "Performance budgets should be part of the product definition, not a cleanup task.",
      score: 18,
    },
    {
      id: randomUUID(),
      postId: seededPosts[1].id,
      authorId: demoUsers[0].id,
      content: "The fixed timestep approach makes the whole thing easier to reason about.",
      score: 12,
    },
  ]);
}

export default router;