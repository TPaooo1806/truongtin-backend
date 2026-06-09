import express from "express";
import { 
  createOrder, 
  verifyPayOSWebhook, 
  trackOrder, 
  adminApproveOrder,
  adminCancelOrder,
  getAllOrdersAdmin,
  lookupOrders,
  updateOrderStatus,
  updatePaymentStatus
} from "../controllers/order.controller";
import { verifyToken, isAdmin } from "../middlewares/auth.middleware"; 

const router = express.Router();

// ==========================================
// ROUTES CHO KHÁCH HÀNG
// ==========================================

// 1. Tạo đơn hàng
router.post("/", createOrder);

// 2. Tra cứu đơn hàng (cũ)
router.post("/track", trackOrder);

// 2.1 Tra cứu đơn hàng mới bằng SĐT
router.get("/lookup", lookupOrders);

// 3. Webhook PayOS
router.post("/webhook", verifyPayOSWebhook);


// ==========================================
// ROUTES CHO ADMIN (QUẢN LÝ KHO)
// ==========================================

/**
 * Lấy danh sách toàn bộ đơn hàng
 * URL: GET http://localhost:5000/api/orders/admin/all
 */
router.get("/admin/all", verifyToken, isAdmin, getAllOrdersAdmin);

/**
 * Duyệt đơn và thực hiện trừ kho hàng
 * URL: PATCH http://localhost:5000/api/orders/approve/:orderId
 */
router.patch("/approve/:orderId", verifyToken, isAdmin, adminApproveOrder);

/**
 * Hủy đơn hàng (cũ)
 * URL: PATCH http://localhost:5000/api/orders/cancel/:orderId
 */
router.patch("/cancel/:orderId", verifyToken, isAdmin, adminCancelOrder);

/**
 * Cập nhật trạng thái giao hàng
 */
router.patch("/admin/status/:id", verifyToken, isAdmin, updateOrderStatus);

/**
 * Cập nhật trạng thái thanh toán (Thủ công cho COD)
 */
router.patch("/admin/payment-status/:id", verifyToken, isAdmin, updatePaymentStatus);

export default router;