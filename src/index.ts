import 'dotenv/config'; 
import express, { Request, Response } from 'express';
import cors from 'cors';
import orderRoutes from "./routes/order.routes";
import apiRoutes from './routes/product.routes'; 
import authRoutes from './routes/auth.routes'; 
import contactRoutes from "./routes/contact.route";
import { getAdminNotifications } from "./controllers/notification.controller";

const app = express();
const PORT = process.env.PORT || 5000;

// Cấu hình CORS để "nhận diện" Frontend khi deploy
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

app.use(cors({
  origin: frontendUrl,
  credentials: true
}));

app.use(express.json());

// Route kiểm tra server
app.get('/', (req: Request, res: Response) => {
  res.send('Backend Trường Tín đang chạy! 🚀');
});

// Routes chính
app.use('/api', apiRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/orders", orderRoutes);

// Route cho liên hệ
app.use("/api/contact", contactRoutes);

app.get("/api/admin/notifications", getAdminNotifications);

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});