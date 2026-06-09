import 'dotenv/config'; 
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import orderRoutes from "./routes/order.routes";
import apiRoutes from './routes/product.routes'; 
import authRoutes from './routes/auth.routes'; 
import categoryRoutes from './routes/category.routes';
import contactRoutes from "./routes/contact.route";
import uploadRoute from './routes/upload.route';
import bannerRoutes from './routes/banner.routes';
import chatRoutes from './routes/chat.route';
import quoteRoutes from './routes/quote.route';
import guestCartRoutes from './routes/guestcart.route';
import cartRoutes from './routes/cart.route';
import shippingRoutes from './routes/shipping.routes';
import { verifyToken, isAdmin } from './middlewares/auth.middleware';
import { getAdminNotifications } from "./controllers/notification.controller";
import catalogCacheService from './services/catalogCache.service';
import { startCronJobs } from './services/cron.service';

const app = express();
const PORT = process.env.PORT || 5000;

// ==========================================
// CORS
// ==========================================
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
// Fix CORS linh hoạt hơn để Vercel (kể cả các bản preview) đều gọi được
const allowedOrigins = [
  frontendUrl,
  'http://localhost:3000',
  'https://truongtin-frontend.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    // Cho phép requests không có origin (ví dụ server-to-server hoặc Postman)
    if (!origin) return callback(null, true);
    
    // Nếu origin nằm trong danh sách cho phép hoặc là domain của Vercel
    if (allowedOrigins.includes(origin) || origin.endsWith('vercel.app')) {
      return callback(null, true);
    }
    
    return callback(new Error('CORS Policy: Origin not allowed'), false);
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser()); // Cho phép đọc Cookie từ request (dùng cho httpOnly JWT)

// ==========================================
// Cấu hình Trust Proxy (QUAN TRỌNG KHI DEPLOY RENDER/VERCEL)
// Nếu không có dòng này, Rate Limit sẽ lấy IP của Load Balancer
// và block TOÀN BỘ người dùng truy cập.
// ==========================================
app.set('trust proxy', 1);

// ==========================================
// [RL-01] RATE LIMITING — Chống Spam & DDoS nhẹ
// Giới hạn 150 request / 1 phút / 1 IP cho toàn bộ /api
// Kẻ tấn công hoặc bot spam sẽ nhận 429 Too Many Requests
// ==========================================
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // Cửa sổ 15 phút
  max: 100,                    // Tối đa 100 request/IP/15 phút
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

// Rate limit cực nghiêm cho tạo đơn hàng (Chống spam API orders)
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 phút
  max: 10,                    // Tối đa 10 đơn hàng / IP / 15 phút
  message: {
    success: false,
    message: 'Bạn đang tạo quá nhiều đơn hàng. Vui lòng thử lại sau 15 phút!'
  }
});

app.use('/api', apiLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/orders', orderLimiter);

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
app.use('/api/categories', categoryRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/orders", orderRoutes);

// Route cho liên hệ
app.use("/api/contact", contactRoutes);

// Route upload ảnh (đã có guard bên trong)
app.use('/api/upload', uploadRoute);

// Route cho banner (đã có guard bên trong)
app.use('/api/banners', bannerRoutes);

// Route cho AI Chatbot
app.use('/api/chat', chatRoutes);

// Route cho Báo giá Zalo (Quote Request)
app.use('/api/quotes', quoteRoutes);

// Route cho Giỏ hàng tạm (Guest Cart)
app.use('/api/guestcart', guestCartRoutes);

// Route cho Giỏ hàng (Validate Cart)
app.use('/api/cart', cartRoutes);

// Route cho Tính phí vận chuyển
app.use('/api/shipping', shippingRoutes);

// Khởi tạo RAM Cache cho AI Chatbot
catalogCacheService.init().then(() => {
  console.log("✅ Catalog Cache Service initialized.");
});

// Khởi chạy các Cron Job ngầm (Quét đơn hết hạn...)
startCronJobs();

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