import 'dotenv/config'; 
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import orderRoutes from "./routes/order.routes";
import apiRoutes from './routes/product.routes'; 
import authRoutes from './routes/auth.routes'; 
import contactRoutes from "./routes/contact.route";
import uploadRoute from './routes/upload.route';
import bannerRoutes from './routes/banner.routes';
import { verifyToken, isAdmin } from './middlewares/auth.middleware';
import { getAdminNotifications } from "./controllers/notification.controller";

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// CORS
// ==========================================
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
app.use(cors({
  origin: frontendUrl,
  credentials: true
}));

app.use(express.json());
app.use(cookieParser()); // Cho phép đọc Cookie từ request (dùng cho httpOnly JWT)

// ==========================================
// [RL-01] RATE LIMITING — Chống Spam & DDoS nhẹ
// Giới hạn 150 request / 1 phút / 1 IP cho toàn bộ /api
// Kẻ tấn công hoặc bot spam sẽ nhận 429 Too Many Requests
// ==========================================
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,   // Cửa sổ 1 phút
  max: 150,                    // Tối đa 150 request/IP/phút
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Bạn thao tác quá nhanh, vui lòng chờ một chút rồi thử lại!'
  }
});

// Rate limit riêng nghiêm hơn cho Auth — Chống brute-force mật khẩu
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 phút
  max: 20,                      // Tối đa 20 lần đăng nhập/IP/15 phút
  message: {
    success: false,
    message: 'Đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút!'
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);

// ==========================================
// Route kiểm tra server
// ==========================================
app.get('/', (req: Request, res: Response) => {
  res.send('Backend Trường Tín đang chạy! 🚀');
});

// ==========================================
// Routes chính
// ==========================================
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/orders", orderRoutes);

// Route cho liên hệ
app.use("/api/contact", contactRoutes);

// Route upload ảnh (đã có guard bên trong)
app.use('/api/upload', uploadRoute);

// Route cho banner (đã có guard bên trong)
app.use('/api/banners', bannerRoutes);

// [BM-06] Thêm guard Admin cho Notification API
// Trước đây không bảo vệ — ai cũng gọi được để xem thông tin đơn hàng khách
app.get("/api/admin/notifications", verifyToken, isAdmin, getAdminNotifications);

// ==========================================
// [RL-01] GLOBAL ERROR HANDLER — Đặt CUỐI CÙNG
// Bắt toàn bộ lỗi bất ngờ chưa được try/catch trong các controller
// Ngăn Node.js bị crash khi có exception không mong muốn
// ==========================================
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('🔥 [Global Error]:', err.stack || err.message);
  res.status(500).json({
    success: false,
    message: 'Hệ thống đang có sự cố, vui lòng thử lại sau!',
    // Chỉ trả về chi tiết lỗi ở môi trường Development để debug
    ...(process.env.NODE_ENV === 'development' && { error: err.message })
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});