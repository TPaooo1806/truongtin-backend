import { PayOS } from "@payos/node";
import { Request, Response } from "express";
import prisma from "../lib/prisma";

// --- Định nghĩa cấu trúc User trong Token ---
interface AuthUser {
  id: number;
  role: string;
  phone?: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// Sử dụng (PayOS as any) để đánh lừa TypeScript, cho phép truyền 3 tham số
const payos = new (PayOS as any)(
  process.env.PAYOS_CLIENT_ID || "",
  process.env.PAYOS_API_KEY || "",
  process.env.PAYOS_CHECKSUM_KEY || ""
);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ==========================================
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (GUEST CHECKOUT)
// ==========================================
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const { fullName, phone, address, paymentMethod, items } = req.body;
  const userId = (req as any).user?.id;

  try {
    const recentOrder = await prisma.order.findFirst({
      where: { 
        phone: phone.trim(), 
        createdAt: { gte: new Date(Date.now() - 15000) } 
      }
    });

    if (recentOrder) {
      res.status(429).json({ success: false, message: "Thao tác quá nhanh, thử lại sau 15 giây." });
      return;
    }

    const payosOrderCode = Number(String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
    
    let calculatedTotal = 0;
    const orderItemsToSave: any[] = [];
    const payosItemsPayload: any[] = [];

    for (const item of items) {
      const dbVariant = await prisma.productVariant.findUnique({
        where: { id: Number(item.variantId || item.id) },
        include: { product: true }
      });

      if (!dbVariant) throw new Error(`Sản phẩm không tồn tại!`);
      if (dbVariant.stock < Number(item.quantity)) {
        throw new Error(`Sản phẩm "${dbVariant.product?.name}" hết hàng!`);
      }

      calculatedTotal += dbVariant.price * Number(item.quantity);
      
      orderItemsToSave.push({
        variantId: dbVariant.id,
        productName: dbVariant.product?.name || item.name, 
        quantity: Number(item.quantity),
        price: dbVariant.price 
      });

      payosItemsPayload.push({
        name: (dbVariant.product?.name || item.name).substring(0, 200),
        quantity: Number(item.quantity),
        price: Number(dbVariant.price)
      });
    }

    const newOrder = await prisma.order.create({
      data: {
        userId: userId ? Number(userId) : undefined, 
        orderCode: payosOrderCode,
        customerName: fullName,
        phone: phone,
        address: address,
        total: calculatedTotal,
        status: (paymentMethod === "COD" ? "PENDING_COD" : "PENDING_PAYOS") as any,
        paymentMethod: paymentMethod as any, 
        items: { create: orderItemsToSave }
      },
    });

    if (paymentMethod === "PAYOS") {
      const paymentData = {
        orderCode: payosOrderCode,
        amount: calculatedTotal,
        description: `Thanh toan don hang`,
        cancelUrl: `${FRONTEND_URL}/cart`,
        returnUrl: `${FRONTEND_URL}/order/success`,
        items: payosItemsPayload 
      };

      // FIX TRIỆT ĐỂ: Dùng Bracket notation để TS không check lỗi type
      const paymentLink = await (payos as any)["createPaymentLink"](paymentData);
      res.status(200).json({ success: true, checkoutUrl: paymentLink.checkoutUrl });
      return;
    }

    res.status(200).json({ 
      success: true, 
      message: "Đặt hàng thành công.",    
      orderCode: newOrder.orderCode.toString() 
    });

  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. PAYOS WEBHOOK
// ==========================================
export const verifyPayOSWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookData = req.body;
    
    // FIX TRIỆT ĐỂ: Dùng Bracket notation để gọi đúng hàm của SDK v2
    const verifiedData = (payos as any)["verifyPaymentWebhookData"](webhookData);

    if (verifiedData.code === '00' || verifiedData.success) {
      const payosOrderCode = verifiedData.orderCode;

      const order = await prisma.order.findUnique({
        where: { orderCode: BigInt(payosOrderCode) }
      });

      if (order && (order.status as string) === "PENDING_PAYOS") {
        await prisma.order.update({
          where: { orderCode: BigInt(payosOrderCode) },
          data: { status: "PAID_PENDING_CONFIRM" as any } 
        });
      }
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false });
  }
};

// ==========================================
// 4. ADMIN: HỦY ĐƠN HÀNG
// ==========================================
export const adminCancelOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;
  try {
    const order = await prisma.order.findUnique({ where: { id: Number(orderId) } });

    if (!order) {
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng" });
      return;
    }

    if (order.status === "PAID_AND_CONFIRMED") {
      res.status(400).json({ success: false, message: "Đơn hàng đã giao và trừ kho không thể tự động hủy." });
      return;
    }

    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: "CANCELLED" }
    });

    res.status(200).json({ success: true, message: "Đã hủy đơn hàng thành công." });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. NGƯỜI DÙNG: TRA CỨU ĐƠN HÀNG (CHO CẢ KHÁCH GUEST)
// ==========================================
export const trackOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderCode, phone } = req.body;

  if (!orderCode || !phone) {
    res.status(400).json({ success: false, message: "Vui lòng cung cấp mã đơn và số điện thoại." });
    return;
  }

  try {
    const order = await prisma.order.findFirst({
      where: { 
        orderCode: BigInt(orderCode), 
        phone: phone.trim() 
      },
      include: {
        items: true
      }
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Thông tin tra cứu không chính xác hoặc đơn hàng không tồn tại." });
      return;
    }

    // Chuyển đổi BigInt sang String trước khi gửi về giao diện
    const orderData = {
      ...order,
      orderCode: order.orderCode.toString(),
    };

    res.status(200).json({ success: true, data: orderData });
  } catch (error: any) {
    res.status(500).json({ success: false, message: "Lỗi hệ thống tra cứu." });
  }
};

// ==========================================
// 6. ADMIN: LẤY DANH SÁCH TOÀN BỘ ĐƠN HÀNG
// ==========================================
export const getAllOrdersAdmin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        items: true
      }
    });

    const safeOrders = orders.map(order => ({
      ...order,
      orderCode: order.orderCode.toString()
    }));

    res.status(200).json({ success: true, data: safeOrders });
  } catch (error: any) {
    res.status(500).json({ success: false, message: "Không thể tải danh sách đơn hàng." });
  }
};