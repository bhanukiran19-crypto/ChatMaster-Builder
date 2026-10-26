import express, { type Express } from "express";
import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { createProxyMiddleware } from "http-proxy-middleware";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Clerk's frontend proxy must see the unparsed request body.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors({ credentials: true, origin: true }));
app.use(
  "/api",
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// This API gateway is the only public route to the FastAPI process. The user
// identity headers are always replaced using the verified Clerk session.
app.use("/api", (req, res, next) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  const claims = auth.sessionClaims as Record<string, unknown> | null;
  req.headers["x-chatmaster-user-id"] = auth.userId;
  req.headers["x-chatmaster-user-email"] =
    typeof claims?.email === "string" ? claims.email : "";
  req.headers["x-chatmaster-user-name"] =
    typeof claims?.name === "string" ? claims.name : "";
  next();
});

app.use(
  "/api",
  createProxyMiddleware({
    target: `http://127.0.0.1:${process.env.CHATMASTER_API_PORT ?? "18081"}`,
    changeOrigin: true,
    on: {
      error(_error, _req, res) {
        if ("writeHead" in res && !res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "ChatMaster API is unavailable." }));
        }
      },
    },
  }),
);

export default app;
