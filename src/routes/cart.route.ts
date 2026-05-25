import { Router } from "express";
import { validateCart } from "../controllers/cart.controller";

const router = Router();

router.post("/validate", validateCart);

export default router;
