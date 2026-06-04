import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vlessRouter from "./vless";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vlessRouter);
router.use(settingsRouter);

export default router;
