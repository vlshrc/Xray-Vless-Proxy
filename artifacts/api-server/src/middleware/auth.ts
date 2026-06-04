import type { Request, Response, NextFunction } from "express";
import { verifyJwt, type JwtPayload } from "../routes/auth";

declare global {
  namespace Express {
    interface Request {
      jwtUser?: JwtPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  const payload = verifyJwt(token);
  if (!payload) {
    res.status(401).json({ ok: false, error: "Invalid token" });
    return;
  }
  req.jwtUser = payload;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if (!req.jwtUser?.isAdmin) {
      res.status(403).json({ ok: false, error: "Admin only" });
      return;
    }
    next();
  });
}
