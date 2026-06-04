import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vlessRouter from "./vless";
import settingsRouter from "./settings";
import metricsRouter from "./metrics";
import installRouter from "./install";
import authRouter from "./auth";
import userRouter from "./user";
import botRouter from "./bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(userRouter);
router.use(botRouter);
router.use(vlessRouter);
router.use(settingsRouter);
router.use(metricsRouter);
router.use(installRouter);

export default router;
