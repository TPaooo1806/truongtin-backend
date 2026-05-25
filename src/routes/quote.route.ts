import { Router } from "express";
import { createQuote, getQuoteByCode } from "../controllers/quote.controller";

const router = Router();

router.post("/", createQuote);
router.get("/:code", getQuoteByCode);

export default router;
