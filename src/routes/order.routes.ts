import express from "express";
import { 
  createOrder, 
  verifyPayOSWebhook, 
  trackOrder, 
  adminApproveOrder,
  getAllOrdersAdmin // Đã import thành công
} from "../controllers/order.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware"; 

const router = express.Router();

// ==========================================
// ROUTES CHO KHÁCH HÀNG
// ==========================================

// 1. Tạo đơn hàng
router.post("/", verifyToken, createOrder);

// 2. Tra cứu đơn hàng
router.post("/track", trackOrder);

// 3. Webhook PayOS
router.post("/webhook", verifyPayOSWebhook);


// ==========================================
// ROUTES CHO ADMIN (QUẢN LÝ KHO)
// ==========================================

/**
 * Lấy danh sách toàn bộ đơn hàng
 * URL: GET http://localhost:5000/api/orders/admin/all
 */
router.get("/admin/all", verifyToken, isAdmin, getAllOrdersAdmin); // <--- BẠN ĐANG THIẾU DÒNG NÀY

/**
 * Duyệt đơn và thực hiện trừ kho hàng
 * URL: PATCH http://localhost:5000/api/orders/approve/:orderId
 */
router.patch("/approve/:orderId", verifyToken, isAdmin, adminApproveOrder);

export default router;