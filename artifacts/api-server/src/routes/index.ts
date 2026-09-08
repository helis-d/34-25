import { Router, type IRouter } from "express";
import healthRouter from "./health";
import communityRouter from "./community";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(communityRouter);
router.use(storageRouter);

export default router;
