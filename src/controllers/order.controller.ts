// =========================================================================
// 🔴 CHỈ DÁN ĐÈ PHẦN ĐẦU FILE (Từ dòng 1 đến trước hàm createOrder)
// =========================================================================

import { Request, Response } from "express";
import prisma from "../lib/prisma";

// 1. Lấy toàn bộ thư viện
const PayOSLib = require("@payos/node");

// 2. Tự động dò tìm đúng Constructor (Khuôn Class)
// Nếu nó giấu trong thuộc tính PayOS, hoặc default, hoặc chính nó
const PayOSClass = PayOSLib.PayOS || PayOSLib.default || PayOSLib;

// ==========================================
// 0. ĐỊNH NGHĨA CẤU TRÚC DỮ LIỆU
// ==========================================
interface AuthUser {
  id: number;
  role: string;
  phone?: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

// 3. Khởi tạo PayOS cực kỳ an toàn
const payos = new PayOSClass(
  process.env.PAYOS_CLIENT_ID || "",
  process.env.PAYOS_API_KEY || "",
  process.env.PAYOS_CHECKSUM_KEY || ""
);

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ==========================================
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (FULL LOGIC)
// ==========================================
// (Từ hàm export const createOrder... trở xuống bạn GIỮ NGUYÊN)

// ==========================================
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (FULL LOGIC)
// ==========================================
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const { fullName, phone, address, paymentMethod, items } = req.body;
  const userId = (req as any).user?.id;

  console.log(`[Order] Bắt đầu tạo đơn hàng cho khách: ${fullName} (${phone})`);

  try {
    // A. CHẶN SPAM: Kiểm tra đơn hàng trùng lặp trong 15 giây
    const recentOrder = await prisma.order.findFirst({
      where: { 
        phone: phone.trim(), 
        createdAt: { gte: new Date(Date.now() - 15000) } 
      }
    });

    if (recentOrder) {
      console.warn(`[Order] Phát hiện spam từ số điện thoại: ${phone}`);
      res.status(429).json({ success: false, message: "Thao tác quá nhanh, vui lòng đợi 15s rồi thử lại." });
      return;
    }

    // B. SINH MÃ ĐƠN HÀNG: Đảm bảo mã là số nguyên an toàn cho PayOS
    const payosOrderCode = Number(String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
    
    let calculatedTotal = 0;
    const orderItemsToSave = [];
    const payosItemsPayload = [];

    // C. KIỂM TRA GIỎ HÀNG & KHO
    for (const item of items) {
      const dbVariant = await prisma.productVariant.findUnique({
        where: { id: Number(item.variantId || item.id) },
        include: { product: true }
      });

      if (!dbVariant) {
        throw new Error(`Sản phẩm (ID: ${item.id}) không tồn tại trong hệ thống.`);
      }

      if (dbVariant.stock < Number(item.quantity)) {
        throw new Error(`Sản phẩm "${dbVariant.product?.name}" chỉ còn ${dbVariant.stock} sản phẩm, không đủ cho đơn hàng của bạn.`);
      }

      const itemPrice = dbVariant.price;
      const itemQuantity = Number(item.quantity);
      calculatedTotal += itemPrice * itemQuantity;
      
      // Lưu thông tin chi tiết vào OrderItem (đã có productName để làm lịch sử)
      orderItemsToSave.push({
        variantId: dbVariant.id,
        productName: dbVariant.product?.name || "Sản phẩm không tên", 
        quantity: itemQuantity,
        price: itemPrice 
      });

      // Payload gửi sang cổng thanh toán
      payosItemsPayload.push({
        name: (dbVariant.product?.name || "SP").substring(0, 200),
        quantity: itemQuantity,
        price: itemPrice
      });
    }

    // D. LƯU VÀO DATABASE
    const newOrder = await prisma.order.create({
      data: {
        userId: userId ? Number(userId) : undefined, // Nếu khách vãng lai thì để null
        orderCode: payosOrderCode,
        customerName: fullName,
        phone: phone,
        address: address,
        total: calculatedTotal,
        paymentMethod: paymentMethod as any,
        status: (paymentMethod === "COD" ? "PENDING_COD" : "PENDING_PAYOS") as any,
        items: {
          create: orderItemsToSave
        }
      },
    });

    console.log(`[Order] Đã lưu đơn hàng #${newOrder.id} vào Database thành công.`);

    // E. XỬ LÝ THANH TOÁN QR (PAYOS)
    if (paymentMethod === "PAYOS") {
      const paymentData = {
        orderCode: payosOrderCode,
        amount: calculatedTotal,
        description: `TT Don Hang #${payosOrderCode}`,
        cancelUrl: `${FRONTEND_URL}/cart`,
        returnUrl: `${FRONTEND_URL}/order/success`,
        items: payosItemsPayload 
      };

      // Bracket notation để bỏ qua lỗi Type
      const paymentLink = await payos["createPaymentLink"](paymentData);
      
      console.log(`[PayOS] Đã tạo link thanh toán QR: ${paymentLink.checkoutUrl}`);
      res.status(200).json({ success: true, checkoutUrl: paymentLink.checkoutUrl });
      return;
    }

    // F. PHẢN HỒI CHO THANH TOÁN COD
    res.status(200).json({ 
      success: true, 
      message: "Đặt hàng thành công. Trường Tín sẽ gọi điện xác nhận sớm nhất.",    
      orderCode: newOrder.orderCode.toString() 
    });

  } catch (error: any) {
    console.error(`[Order Error] Lỗi khi tạo đơn: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. ADMIN: DUYỆT ĐƠN & TRỪ KHO (TRANSACTION)
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
        throw new Error("Đơn hàng này đã được xử lý xong hoặc đã bị hủy.");
      }

      // Kiểm tra kho lần cuối trước khi trừ
      for (const item of order.items) {
        if (!item.variantId) continue;
        const variant = await tx.productVariant.findUnique({ where: { id: item.variantId } });
        if (!variant || variant.stock < item.quantity) {
          throw new Error(`Sản phẩm "${item.productName}" không đủ tồn kho để duyệt!`);
        }
      }

      // Trừ kho hàng loạt
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { decrement: item.quantity } }
        });
      }

      // Cập nhật trạng thái cuối cùng
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAID_AND_CONFIRMED" as any }
      });
    });

    res.status(200).json({ success: true, message: "Duyệt đơn hàng và cập nhật kho thành công!" });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. PAYOS WEBHOOK: NHẬN TÍN HIỆU TIỀN VỀ
// ==========================================
export const verifyPayOSWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookData = req.body;
    
    // Gọi hàm verify của SDK v2
    const verifiedData = payos["verifyPaymentWebhookData"](webhookData);

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
        console.log(`[Webhook] Đơn hàng #${payosOrderCode} đã thanh toán thành công.`);
      }
    }
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(`[Webhook Error] Xác thực thất bại: ${error.message}`);
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
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng để hủy." });
      return;
    }

    if (order.status === "PAID_AND_CONFIRMED") {
      res.status(400).json({ success: false, message: "Đơn hàng đã hoàn tất giao nhận, không thể hủy tự động." });
      return;
    }

    await prisma.order.update({
      where: { id: Number(orderId) },
      data: { status: "CANCELLED" as any }
    });

    res.status(200).json({ success: true, message: "Đơn hàng đã được chuyển sang trạng thái Hủy." });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ==========================================
// 5. TRA CỨU ĐƠN HÀNG (DÀNH CHO KHÁCH)
// ==========================================
export const trackOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderCode, phone } = req.body;

  if (!orderCode || !phone) {
    res.status(400).json({ success: false, message: "Vui lòng nhập đủ Mã đơn hàng và Số điện thoại." });
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
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng với thông tin đã cung cấp." });
      return;
    }

    const orderData = {
      ...order,
      orderCode: order.orderCode.toString(), // Chuyển BigInt về string cho Frontend
    };

    res.status(200).json({ success: true, data: orderData });
  } catch (error: any) {
    res.status(500).json({ success: false, message: "Lỗi hệ thống tra cứu." });
  }
};

// ==========================================
// 6. ADMIN: LẤY DANH SÁCH TẤT CẢ ĐƠN HÀNG
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
// =========================================================================
// 🔴 KẾT THÚC FILE
// =========================================================================