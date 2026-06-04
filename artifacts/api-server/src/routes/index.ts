import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vlessRouter from "./vless";
import settingsRouter from "./settings";
import metricsRouter from "./metrics";
import installRouter from "./install";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vlessRouter);
router.use(settingsRouter);
router.use(metricsRouter);
router.use(installRouter);

export default router;
