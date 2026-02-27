import { PayOS } from "@payos/node";
import { Request, Response } from "express";
import prisma from "../lib/prisma";

// --- Định nghĩa cấu trúc User trong Token ---
interface AuthUser {
  id: number;
  role: string;
  phone?: string;
}

// Mở rộng Request của Express để hỗ trợ middleware auth
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
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (GUEST CHECKOUT)
// ==========================================
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const { fullName, phone, address, paymentMethod, items } = req.body;
  
  // Lấy userId nếu có đăng nhập (Dùng optional chaining để tránh lỗi nếu không có middleware auth)
  const userId = (req as any).user?.id;

  try {
    // Chặn spam: Một số điện thoại không đặt đơn liên tục trong 15s
    const recentOrder = await prisma.order.findFirst({
      where: { 
        phone: phone.trim(), 
        createdAt: { gte: new Date(Date.now() - 15000) } 
      }
    });

    if (recentOrder) {
      res.status(429).json({ success: false, message: "Thao tác quá nhanh, vui lòng thử lại sau 15 giây." });
      return;
    }

    // Tối ưu mã đơn hàng PayOS: Đảm bảo là số nguyên an toàn (< 2^53 - 1)
    const payosOrderCode = Number(String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
    
    let calculatedTotal = 0;
    const orderItemsToSave: any[] = [];
    const payosItemsPayload: any[] = [];

    // Kiểm tra kho và tính toán giá trị đơn hàng
    for (const item of items) {
      const dbVariant = await prisma.productVariant.findUnique({
        where: { id: Number(item.variantId || item.id) },
        include: { product: true }
      });

      if (!dbVariant) throw new Error(`Sản phẩm với ID ${item.id} không tồn tại!`);
      if (dbVariant.stock < Number(item.quantity)) {
        throw new Error(`Sản phẩm "${dbVariant.product?.name}" hiện không đủ hàng trong kho!`);
      }

      calculatedTotal += dbVariant.price * Number(item.quantity);
      
      // Chuẩn bị lưu vào bảng OrderItem của Database
      orderItemsToSave.push({
        variantId: dbVariant.id,
        productName: dbVariant.product?.name || item.name, // Lưu tên SP để làm lịch sử
        quantity: Number(item.quantity),
        price: dbVariant.price 
      });

      // Chuẩn bị gửi sang cổng PayOS (tên SP không quá 200 ký tự)
      payosItemsPayload.push({
        name: (dbVariant.product?.name || item.name).substring(0, 200),
        quantity: Number(item.quantity),
        price: Number(dbVariant.price)
      });
    }

    // Tạo đơn hàng trong Database
    const newOrder = await prisma.order.create({
      data: {
        // Nếu không đăng nhập, userId sẽ được lưu là NULL
        userId: userId ? Number(userId) : undefined, 
        orderCode: payosOrderCode,
        customerName: fullName,
        phone: phone,
        address: address,
        total: calculatedTotal,
        // Phân loại trạng thái ban đầu dựa trên phương thức thanh toán
        status: paymentMethod === "COD" ? "PENDING_COD" : "PENDING_PAYOS",
        paymentMethod: paymentMethod,
        items: {
          create: orderItemsToSave
        }
      },
    });

    // Xử lý nếu khách chọn thanh toán qua PayOS
    if (paymentMethod === "PAYOS") {
      const paymentData = {
        orderCode: payosOrderCode,
        amount: calculatedTotal,
        description: `Thanh toan don hang`, // Giữ ngắn gọn < 25 ký tự theo quy định PayOS
        cancelUrl: `${FRONTEND_URL}/cart`,
        returnUrl: `${FRONTEND_URL}/order/success`,
        items: payosItemsPayload 
      };

      const paymentLink = await payos.paymentRequests.create(paymentData);
      res.status(200).json({ success: true, checkoutUrl: paymentLink.checkoutUrl });
      return;
    }

    // Trả về cho khách chọn COD
    res.status(200).json({ 
      success: true, 
      message: "Đặt hàng thành công. Chúng tôi sẽ sớm liên hệ xác nhận đơn hàng.",    
      orderCode: newOrder.orderCode.toString() 
    });

  } catch (error: any) {
    console.error("Lỗi tạo đơn hàng:", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. ADMIN: DUYỆT ĐƠN (TRỪ KHO THỰC TẾ)
// ==========================================
export const adminApproveOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: Number(orderId) },
        include: { items: true }
      });

      if (!order) throw new Error("Không tìm thấy đơn hàng trên hệ thống!");
      if (order.status === "PAID_AND_CONFIRMED" || order.status === "CANCELLED") {
        throw new Error("Đơn hàng này đã được xử lý hoặc đã bị hủy trước đó.");
      }

      // Kiểm tra kho lần cuối trước khi duyệt đơn
      for (const item of order.items) {
        if (!item.variantId) continue;
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant || variant.stock < item.quantity) {
          throw new Error(`Sản phẩm "${item.productName}" không đủ tồn kho để duyệt đơn này!`);
        }
      }

      // Thực hiện trừ kho từng sản phẩm
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } }
        });
      }

      // Cập nhật đơn hàng sang trạng thái cuối cùng
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID_AND_CONFIRMED" }
      });
    });

    res.status(200).json({ success: true, message: "Đã duyệt đơn và trừ tồn kho thành công!" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. PAYOS WEBHOOK: NHẬN THÔNG BÁO TIỀN VỀ
// ==========================================
export const verifyPayOSWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookData = req.body;
    
    // Xác thực chữ ký dữ liệu từ PayOS gửi về (Chống giả mạo)
    payos.webhooks.verify(webhookData);

    // Code '00' là khách đã chuyển khoản thành công
    if (webhookData.code === '00') {
      const payosOrderCode = webhookData.data.orderCode;

      // Tìm đơn hàng (Sử dụng BigInt để khớp với Database)
      const order = await prisma.order.findUnique({
        where: { orderCode: BigInt(payosOrderCode) }
      });

      if (!order) {
        console.error(`[Webhook] Không tìm thấy đơn hàng: ${payosOrderCode}`);
        res.status(404).json({ success: false, message: "Order not found" });
        return;
      }

      // Chỉ cập nhật nếu đơn đang chờ PayOS thanh toán
      if (order.status === "PENDING_PAYOS") {
        await prisma.order.update({
          where: { orderCode: BigInt(payosOrderCode) },
          data: { status: "PAID_PENDING_CONFIRM" } 
        });
        console.log(`[Webhook] Đơn hàng ${payosOrderCode} đã thanh toán thành công.`);
      }
    }

    // Luôn trả về 200 cho PayOS theo quy định của họ
    res.status(200).json({ success: true });

  } catch (error: any) {
    console.error("[Webhook Error]:", error.message);
    res.status(400).json({ success: false, message: "Webhook verification failed" });
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