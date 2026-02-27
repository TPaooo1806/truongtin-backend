import { PayOS } from "@payos/node";
import { Request, Response } from "express";
import prisma from "../lib/prisma";
// Định nghĩa cấu trúc User trong Token
interface AuthUser {
  id: number;
  role: string;
  phone?: string;
}

// Mở rộng Request của Express
interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// ==========================================
// KHỞI TẠO PAYOS
// ==========================================
const payos = new PayOS({
  clientId: process.env.PAYOS_CLIENT_ID || "",
  apiKey: process.env.PAYOS_API_KEY || "",
  checksumKey: process.env.PAYOS_CHECKSUM_KEY || ""
});

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ==========================================
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (CHƯA TRỪ KHO)
// ==========================================
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const { fullName, phone, address, paymentMethod, items } = req.body;
  const userId = (req as any).user?.id;

  if (!userId) {
    res.status(401).json({ success: false, message: "Vui lòng đăng nhập!" });
    return;
  }

  try {
    // Anti-spam: Chặn tạo đơn liên tục trong 15s
    const recentOrder = await prisma.order.findFirst({
      where: { userId: Number(userId), createdAt: { gte: new Date(Date.now() - 15000) } }
    });
    if (recentOrder) {
      res.status(429).json({ success: false, message: "Thao tác quá nhanh, thử lại sau 15s." });
      return;
    }

    const payosOrderCode = Number(String(Date.now()) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
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

      payosItemsPayload.push({
        name: dbVariant.product?.name.substring(0, 20) || `SP ${dbVariant.id}`,
        quantity: Number(item.quantity),
        price: Number(dbVariant.price)
      });
    }

    // Tạo đơn hàng (Trạng thái PENDING)
    const newOrder = await prisma.order.create({
      data: {
        userId: Number(userId),
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
        description: `Thanh toan don ${newOrder.id}`,
        cancelUrl: `${FRONTEND_URL}/order/cancel`,
        returnUrl: `${FRONTEND_URL}/order/success`,
        items: payosItemsPayload
      };

      const paymentLink = await payos.paymentRequests.create(paymentData);
      res.status(200).json({ success: true, checkoutUrl: paymentLink.checkoutUrl });
      return;
    }

    res.status(200).json({ success: true, message: "Đặt hàng thành công. Chờ xác nhận.",    orderCode: newOrder.orderCode?.toString() ?? payosOrderCode.toString() });

  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. ADMIN: DUYỆT ĐƠN (THỰC SỰ TRỪ KHO TẠI ĐÂY)
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

      // Kiểm tra kho lần cuối
      for (const item of order.items) {
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant || variant.stock < item.quantity) {
          throw new Error(`Sản phẩm #${item.variantId} không đủ tồn kho để duyệt đơn!`);
        }
      }

      // Trừ kho và Cập nhật trạng thái
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
// 3. PAYOS WEBHOOK (XÁC NHẬN TIỀN VỀ)
// ==========================================
export const verifyPayOSWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookData = req.body;
    
    // 1. Xác thực tính toàn vẹn của dữ liệu từ PayOS (Chống giả mạo)
    payos.webhooks.verify(webhookData);

    // 2. Kiểm tra mã thành công (code '00' là thanh toán thành công)
    if (webhookData.code === '00') {
      const payosOrderCode = webhookData.data.orderCode;

      // 3. Tìm đơn hàng trong Database
      const order = await prisma.order.findUnique({
        where: { orderCode: payosOrderCode }
      });

      if (!order) {
        console.error(`[Webhook Error] Không tìm thấy đơn hàng: ${payosOrderCode}`);
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }

      // 4. Chỉ cập nhật nếu đơn đang ở trạng thái chờ thanh toán
      // Không ghi đè nếu Admin đã bấm duyệt hoặc khách đã hủy
      if (order.status === "PENDING_PAYOS") {
        await prisma.order.update({
          where: { orderCode: payosOrderCode },
          data: { status: "PAID_PENDING_CONFIRM" } 
        });
        console.log(`[Webhook Success] Đơn hàng ${payosOrderCode} đã thanh toán.`);
      } else {
        console.log(`[Webhook Info] Đơn hàng ${payosOrderCode} đã được xử lý trước đó (Status: ${order.status}).`);
      }
    }

    // PayOS yêu cầu bạn luôn trả về status 200/json nếu nhận webhook thành công
    res.status(200).json({ success: true });

  } catch (error) {
    const err = error as Error;
    console.error("[Webhook Error] Xác thực Webhook thất bại:", err.message);
    // Trả về 400 để PayOS biết và có thể gửi lại webhook sau đó
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
      res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng"
      });
      return;
    }

    if (order.status === "PAID_AND_CONFIRMED") {
      res.status(400).json({
        success: false,
        message: "Không thể huỷ đơn đã duyệt"
      });
      return;
    }

    if (order.status === "CANCELLED") {
      res.status(400).json({
        success: false,
        message: "Đơn đã bị huỷ trước đó"
      });
      return;
    }

    await prisma.order.update({
      where: { id: Number(orderId) },
      data: {
        status: "CANCELLED"
      }
    });

    res.status(200).json({
      success: true,
      message: "Đã huỷ đơn hàng"
    });

  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message
    });
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
          include: {
            variant: { include: { product: true } }
          }
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

/**
 * Lấy danh sách toàn bộ đơn hàng (Dành cho Admin)
 */
export const getAllOrdersAdmin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const orders = await prisma.order.findMany({
      orderBy: {
        createdAt: 'desc', // Đơn hàng mới nhất hiện lên đầu
      },
      include: {
        items: {
          include: {
            variant: {
              include: {
                product: true // Lấy thêm tên sản phẩm để hiển thị ở chi tiết đơn
              }
            }
          }
        }
      }
    });

    // QUAN TRỌNG: Xử lý BigInt của orderCode thành String để tránh lỗi JSON và bị làm tròn số
    const safeOrders = orders.map(order => ({
      ...order,
      orderCode: order.orderCode ? order.orderCode.toString() : null
    }));

    res.status(200).json({
      success: true,
      data: safeOrders
    });
  } catch (error) {
    const err = error as Error;
    console.error("Lỗi lấy danh sách đơn hàng:", err.message);
    res.status(500).json({
      success: false,
      message: "Không thể lấy danh sách đơn hàng hệ thống."
    });
  }
};