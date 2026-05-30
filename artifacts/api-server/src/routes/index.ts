import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vlessRouter from "./vless";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vlessRouter);

export default router;
