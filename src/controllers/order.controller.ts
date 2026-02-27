import { PayOS } from "@payos/node";
import { Request, Response } from "express";
import prisma from "../lib/prisma";

interface AuthUser {
  id: number;
  role: string;
  phone?: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// ==========================================
// KHỞI TẠO PAYOS (Dùng chuẩn Object theo version của bạn)
// ==========================================
const payos = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID || "",
  apiKey: process.env.PAYOS_API_KEY || "",
  checksumKey: process.env.PAYOS_CHECKSUM_KEY || ""
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ==========================================
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (HỖ TRỢ KHÁCH VÃNG LAI)
// ==========================================
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const { fullName, phone, address, paymentMethod, items } = req.body;
  
  // Lấy userId nếu có đăng nhập (Không ép buộc)
  const userId = (req as any).user?.id;

  try {
    // Chặn spam 15s (Dùng số điện thoại để chặn vì khách có thể không đăng nhập)
    const recentOrder = await prisma.order.findFirst({
      where: { phone: phone.trim(), createdAt: { gte: new Date(Date.now() - 15000) } }
    });
    if (recentOrder) {
      res.status(429).json({ success: false, message: "Thao tác quá nhanh, thử lại sau 15s." });
      return;
    }

    // TỐI ƯU MÃ ĐƠN HÀNG PAYOS: Đảm bảo mã sinh ra là Số nguyên an toàn
    const payosOrderCode = Number(String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
    
    let calculatedTotal = 0;
    const orderItemsToSave: any[] = [];
    const payosItemsPayload: any[] = [];

    // Kiểm tra kho sơ bộ
    for (const item of items) {
      const dbVariant = await prisma.productVariant.findUnique({
        where: { id: Number(item.variantId || item.id) },
        include: { product: true }
      });

      if (!dbVariant) throw new Error("Có sản phẩm không tồn tại!");
      if (dbVariant.stock < Number(item.quantity)) {
        throw new Error(`Sản phẩm ${dbVariant.product?.name} đã hết hàng!`);
      }

      calculatedTotal += dbVariant.price * Number(item.quantity);
      orderItemsToSave.push({
        variantId: dbVariant.id,
        quantity: Number(item.quantity),
        price: dbVariant.price 
      });

      // Để PayOS hiện tên sản phẩm mà không bị lỗi
      payosItemsPayload.push({
        name: dbVariant.product?.name.substring(0, 200) || `SP #${dbVariant.id}`,
        quantity: Number(item.quantity),
        price: Number(dbVariant.price)
      });
    }

    // Tạo đơn hàng (Trạng thái PENDING)
    const newOrder = await prisma.order.create({
      data: {
        userId: userId || null,
        orderCode: payosOrderCode,
        customerName: fullName,
        phone: phone,
        address: address,
        total: calculatedTotal,
        status: paymentMethod === "COD" ? "PENDING_COD" : "PENDING_PAYOS",
        items: { create: orderItemsToSave }
      },
    });

    // Nếu chọn PayOS -> Trả về link thanh toán
    if (paymentMethod === "PAYOS") {
      const paymentData = {
        orderCode: payosOrderCode,
        amount: calculatedTotal,
        description: `Thanh toan don hang`, // ĐÃ FIX: Chỉ 19 ký tự, thỏa mãn chuẩn < 25 ký tự của PayOS
        cancelUrl: `${FRONTEND_URL}/order/cancel`,
        returnUrl: `${FRONTEND_URL}/order/success`,
        items: payosItemsPayload 
      };

      const paymentLink = await payos.paymentRequests.create(paymentData);
      res.status(200).json({ success: true, checkoutUrl: paymentLink.checkoutUrl });
      return;
    }

    res.status(200).json({ 
      success: true, 
      message: "Đặt hàng thành công. Chờ xác nhận.",    
      orderCode: newOrder.orderCode?.toString() ?? payosOrderCode.toString() 
    });

  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. ADMIN: DUYỆT ĐƠN
// ==========================================
export const adminApproveOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: Number(orderId) },
        include: { items: true }
      });

      if (!order) throw new Error("Không tìm thấy đơn hàng!");
      if (order.status === "PAID_AND_CONFIRMED" || order.status === "CANCELLED") {
        throw new Error("Đơn hàng này đã được xử lý rồi.");
      }

      for (const item of order.items) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant || variant.stock < item.quantity) {
          throw new Error(`Sản phẩm #${item.variantId} không đủ tồn kho để duyệt đơn!`);
        }
      }

      for (const item of order.items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } }
        });
      }

      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID_AND_CONFIRMED" }
      });
    });

    res.status(200).json({ success: true, message: "Duyệt đơn thành công, kho đã trừ." });
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
    
    // TRỞ VỀ HÀM VERIFY CHUẨN CỦA VERSION BẠN ĐANG DÙNG
    payos.webhooks.verify(webhookData);

    if (webhookData.code === '00') {
      const payosOrderCode = webhookData.data.orderCode;

      // SỬA LỖI BIGINT CHO PRISMA
      const order = await prisma.order.findUnique({
        where: { orderCode: BigInt(payosOrderCode) }
      });

      if (!order) {
        console.error(`[Webhook Error] Không tìm thấy đơn hàng: ${payosOrderCode}`);
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }

      if (order.status === "PENDING_PAYOS") {
        await prisma.order.update({
          where: { orderCode: BigInt(payosOrderCode) },
          data: { status: "PAID_PENDING_CONFIRM" } 
        });
        console.log(`[Webhook Success] Đơn hàng ${payosOrderCode} đã thanh toán.`);
      } else {
        console.log(`[Webhook Info] Đơn hàng ${payosOrderCode} đã được xử lý trước đó.`);
      }
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error("[Webhook Error] Xác thực Webhook thất bại:", error);
    res.status(400).json({ success: false, message: "Webhook verification failed" });
  }
};

// ==========================================
// 4. ADMIN: HỦY ĐƠN
// ==========================================
export const adminCancelOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;

  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(orderId) }
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng" });
      return;
    }

    if (order.status === "PAID_AND_CONFIRMED") {
      res.status(400).json({ success: false, message: "Không thể huỷ đơn đã duyệt" });
      return;
    }

    if (order.status === "CANCELLED") {
      res.status(400).json({ success: false, message: "Đơn đã bị huỷ trước đó" });
      return;
    }

    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: "CANCELLED" }
    });

    res.status(200).json({ success: true, message: "Đã huỷ đơn hàng" });

  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. NGƯỜI DÙNG: TRA CỨU ĐƠN HÀNG
// ==========================================
export const trackOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderCode, phone } = req.body;

  if (!orderCode || !phone) {
    res.status(400).json({ success: false, message: "Vui lòng nhập đầy đủ thông tin." });
    return;
  }

  try {
    let parsedOrderCode: bigint;
    try {
      parsedOrderCode = BigInt(orderCode);
    } catch (e) {
      res.status(400).json({ success: false, message: "Mã đơn hàng không hợp lệ." });
      return;
    }

    const order = await prisma.order.findFirst({
      where: { orderCode: parsedOrderCode, phone: phone.trim() },
      include: {
        items: {
          include: { variant: { include: { product: true } } }
        }
      }
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng." });
      return;
    }

    const orderData = {
      ...order,
      orderCode: order.orderCode ? order.orderCode.toString() : null,
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
        items: {
          include: { variant: { include: { product: true } } }
        }
      }
    });

    const safeOrders = orders.map(order => ({
      ...order,
      orderCode: order.orderCode ? order.orderCode.toString() : null
    }));

    res.status(200).json({ success: true, data: safeOrders });
  } catch (error) {
    const err = error as Error;
    console.error("Lỗi lấy danh sách đơn hàng:", err.message);
    res.status(500).json({ success: false, message: "Không thể lấy danh sách đơn hàng hệ thống." });
  }
};