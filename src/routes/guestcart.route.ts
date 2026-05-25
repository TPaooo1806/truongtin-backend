import { Router } from "express";
import { saveGuestCart, getGuestCart } from "../controllers/guestcart.controller";

const router = Router();

router.post("/", saveGuestCart);
router.get("/:phone", getGuestCart);

export default router;
