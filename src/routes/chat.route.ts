import { Router } from 'express';
import { chatWithAI } from '../controllers/chat.controller';
import rateLimit from 'express-rate-limit';

const router = Router();

// Rate limiting riêng cho API chat để tránh spam bot làm hết token
const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // Limit each IP to 30 requests per `window` (here, per 15 minutes)
  message: { success: false, message: "Bạn đã chat quá nhiều, vui lòng thử lại sau 15 phút." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Endpoint: POST /api/chat
router.post('/', chatLimiter, chatWithAI);

export default router;
