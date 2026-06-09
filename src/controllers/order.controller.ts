import { Request, Response } from "express";
import prisma from "../lib/prisma";

// 1. Lấy toàn bộ thư viện PayOS
const PayOSLib = require("@payos/node");
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

// 2. KHỞI TẠO TẮC KÈ HOA: Chấp mọi phiên bản v1 hay v2 trên Render
const clientId = process.env.PAYOS_CLIENT_ID || "";
const apiKey = process.env.PAYOS_API_KEY || "";
const checksumKey = process.env.PAYOS_CHECKSUM_KEY || "";

let payos: any;
try {
  // Thử khởi tạo bản v2 (truyền 3 chuỗi)
  payos = new PayOSClass(clientId, apiKey, checksumKey);
  // Nếu khởi tạo xong mà không thấy hàm nào, thử lại với cấu trúc v1 (truyền object)
  if (!payos.createPaymentLink && !payos.paymentRequests) {
    payos = new PayOSClass({ clientId, apiKey, checksumKey });
  }
} catch (error) {
    console.error("Lỗi:", error);
  payos = new PayOSClass({ clientId, apiKey, checksumKey });
}

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// ==========================================
// 1. NGƯỜI DÙNG: TẠO ĐƠN HÀNG (FULL LOGIC)
// ==========================================
export const createOrder = async (req: Request, res: Response): Promise<void> => {
  const { fullName, phone, address, paymentMethod, items } = req.body;
  const userId = (req as any).user?.id;

  console.log(`[Order] Bắt đầu tạo đơn hàng cho khách: ${fullName} (${phone})`);

  try {
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

    const payosOrderCode = Number(String(Date.now()).slice(-9) + String(Math.floor(Math.random() * 1000)).padStart(3, '0'));
    
    // TẠO TRANSACTION CHẶN RACE CONDITION
    const newOrder = await prisma.$transaction(async (tx) => {
      let calculatedTotal = 0;
      const orderItemsToSave = [];
      const payosItemsPayload = [];

      for (const item of items) {
        // Query kiểm tra kho trực tiếp trong Transaction
        const dbVariant = await tx.productVariant.findUnique({
          where: { id: Number(item.variantId || item.id) },
          include: { product: true }
        });

        if (!dbVariant) throw new Error(`Sản phẩm (ID: ${item.id}) không tồn tại trong hệ thống.`);
        
        // Kiểm tra hụt kho
        if (dbVariant.stock < Number(item.quantity)) {
          throw new Error(`Sản phẩm "${dbVariant.product?.name}" chỉ còn ${dbVariant.stock} sản phẩm. Đơn hàng đã bị hủy bỏ để đảm bảo tồn kho.`);
        }

        const itemPrice = dbVariant.price;
        const itemQuantity = Number(item.quantity);
        calculatedTotal += itemPrice * itemQuantity;
        
        // Trừ kho trực tiếp
        await tx.productVariant.update({
          where: { id: dbVariant.id },
          data: { stock: { decrement: itemQuantity } }
        });

        orderItemsToSave.push({
          variantId: dbVariant.id,
          productName: dbVariant.product?.name || "Sản phẩm không tên", 
          quantity: itemQuantity,
          price: itemPrice 
        });

        payosItemsPayload.push({
          name: (dbVariant.product?.name || "SP").substring(0, 200),
          quantity: itemQuantity,
          price: itemPrice
        });
      }

      const createdOrder = await tx.order.create({
        data: {
          userId: userId ? Number(userId) : undefined,
          orderCode: payosOrderCode,
          customerName: fullName,
          phone: phone,
          address: address,
          total: calculatedTotal,
          paymentMethod: paymentMethod as any,
          paymentStatus: "UNPAID",
          status: (paymentMethod === "COD" ? "PENDING_COD" : "PENDING_PAYOS") as any,
          items: { create: orderItemsToSave }
        },
      });
      
      return { createdOrder, payosItemsPayload, calculatedTotal };
    });

    console.log(`[Order] Đã lưu đơn hàng #${newOrder.createdOrder.id} vào Database thành công.`);

    // E. XỬ LÝ THANH TOÁN QR (TỰ ĐỘNG DÒ HÀM THEO PHIÊN BẢN)
    if (paymentMethod === "PAYOS") {
      const paymentData = {
        orderCode: payosOrderCode,
        amount: newOrder.calculatedTotal,
        description: `TT Don Hang #${payosOrderCode}`,
        cancelUrl: `${FRONTEND_URL}/checkout?status=cancelled`,
        returnUrl: `${FRONTEND_URL}/order/success`,
        items: newOrder.payosItemsPayload 
      };

      let checkoutUrl = "";

      // Bẻ lái: Gọi hàm bản mới (v2), nếu không có thì gọi hàm bản cũ (v1)
      if (typeof payos.createPaymentLink === "function") {
        const paymentLink = await payos.createPaymentLink(paymentData);
        checkoutUrl = paymentLink.checkoutUrl;
      } else if (payos.paymentRequests && typeof payos.paymentRequests.create === "function") {
        const paymentLink = await payos.paymentRequests.create(paymentData);
        checkoutUrl = paymentLink.checkoutUrl;
      } else {
        throw new Error("Lỗi PayOS: Không tìm thấy hàm tạo link ở cả 2 phiên bản!");
      }

      // Lưu URL thanh toán vào DB
      await prisma.order.update({
        where: { id: newOrder.createdOrder.id },
        data: { paymentUrl: checkoutUrl }
      });
      
      console.log(`[PayOS] Đã tạo link thanh toán QR và lưu vào DB: ${checkoutUrl}`);
      res.status(200).json({ success: true, checkoutUrl });
      return;
    }

    res.status(200).json({ 
      success: true, 
      message: "Đặt hàng thành công. Trường Tín sẽ gọi điện xác nhận sớm nhất.",    
      orderCode: newOrder.createdOrder.orderCode.toString() 
    });

  } catch (error: any) {
    console.error(`[Order Error] Lỗi khi tạo đơn: ${error.message}`);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 2. ADMIN: DUYỆT ĐƠN & TRỪ KHO
// ==========================================
export const adminApproveOrder = async (req: Request, res: Response): Promise<void> => {
  const { orderId } = req.params;

  try {
    const order = await prisma.order.findUnique({
      where: { id: Number(orderId) },
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng!" });
      return;
    }
    if (order.status === "PAID_AND_CONFIRMED" || order.status === "CANCELLED") {
      res.status(400).json({ success: false, message: "Đơn hàng này đã được xử lý xong hoặc đã bị hủy." });
      return;
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { status: "PAID_AND_CONFIRMED" as any }
    });

    res.status(200).json({ success: true, message: "Duyệt đơn hàng thành công!" });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 3. PAYOS WEBHOOK: TỰ ĐỘNG BẺ LÁI THEO PHIÊN BẢN
// ==========================================
export const verifyPayOSWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const webhookData = req.body;
    let verifiedData;
    
    // Bẻ lái: Gọi hàm bản mới (v2), nếu không có thì gọi hàm bản cũ (v1)
    if (typeof payos.verifyPaymentWebhookData === "function") {
      verifiedData = payos.verifyPaymentWebhookData(webhookData);
    } else if (payos.webhooks && typeof payos.webhooks.verify === "function") {
      verifiedData = payos.webhooks.verify(webhookData);
    } else {
      throw new Error("Lỗi PayOS: Không tìm thấy hàm verify.");
    }

    const isSuccess = verifiedData.code === '00' || verifiedData.success === true || verifiedData.status === 'PAID';
    const isCancelled = verifiedData.desc === 'cancel' || verifiedData.status === 'CANCELLED' || verifiedData.code === '01';
    const isExpired = verifiedData.status === 'EXPIRED';

    const payosOrderCode = verifiedData.orderCode;
    const order = await prisma.order.findUnique({
      where: { orderCode: BigInt(payosOrderCode) },
      include: { items: true }
    });

    if (order && (order.status as string) === "PENDING_PAYOS") {
      if (isSuccess) {
        await prisma.order.update({
          where: { orderCode: BigInt(payosOrderCode) },
          data: { 
            status: "PAID_PENDING_CONFIRM" as any,
            paymentStatus: "PAID"
          } 
        });
        console.log(`[Webhook] Đơn hàng #${payosOrderCode} đã thanh toán thành công.`);
      } else if (isCancelled || isExpired) {
        // Hoàn lại kho
        await prisma.$transaction(async (tx) => {
          for (const item of order.items) {
            if (!item.variantId) continue;
            await tx.productVariant.update({
              where: { id: item.variantId },
              data: { stock: { increment: item.quantity } }
            });
          }
          await tx.order.update({
            where: { orderCode: BigInt(payosOrderCode) },
            data: { 
              status: "CANCELLED" as any,
              paymentStatus: isExpired ? "EXPIRED" : "CANCELLED"
            }
          });
        });
        console.log(`[Webhook] Đơn hàng #${payosOrderCode} đã bị hủy thanh toán.`);
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
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ 
        where: { id: Number(orderId) },
        include: { items: true }
      });

      if (!order) {
        throw new Error("Không tìm thấy đơn hàng để hủy.");
      }

      if (order.status === "PAID_AND_CONFIRMED") {
        throw new Error("Đơn hàng đã hoàn tất giao nhận, không thể hủy tự động.");
      }
      if (order.status === "CANCELLED") {
        throw new Error("Đơn hàng này đã bị hủy rồi.");
      }

      // Hoàn lại kho
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { stock: { increment: item.quantity } }
        });
      }

      await tx.order.update({
        where: { id: Number(orderId) },
        data: { status: "CANCELLED" as any }
      });
    });

    res.status(200).json({ success: true, message: "Đơn hàng đã được chuyển sang trạng thái Hủy và Hoàn kho thành công." });
  } catch (error: any) {
    console.error("Lỗi:", error);
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
      include: { items: true }
    });

    if (!order) {
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng với thông tin đã cung cấp." });
      return;
    }

    const orderData = {
      ...order,
      orderCode: order.orderCode.toString(),
    };

    res.status(200).json({ success: true, data: orderData });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống tra cứu." });
  }
};

// ==========================================
// 6. ADMIN: LẤY DANH SÁCH TẤT CẢ ĐƠN HÀNG
// ==========================================
export const getAllOrdersAdmin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const whereClause = {
      paymentStatus: {
        in: ["UNPAID", "PAID"]
      }
    };

    const [orders, totalOrders] = await Promise.all([
      prisma.order.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
        skip,
        take: limit
      }),
      prisma.order.count({ where: whereClause })
    ]);

    const safeOrders = orders.map(order => ({
      ...order,
      orderCode: order.orderCode.toString()
    }));

    res.status(200).json({ 
      success: true, 
      data: safeOrders,
      totalOrders,
      totalPages: Math.ceil(totalOrders / limit),
      currentPage: page
    });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Không thể tải danh sách đơn hàng." });
  }
};

// ==========================================
// 7. TRA CỨU DANH SÁCH ĐƠN HÀNG (DÀNH CHO KHÁCH BẰNG SĐT)
// ==========================================
export const lookupOrders = async (req: Request, res: Response): Promise<void> => {
  const { phone } = req.query;

  if (!phone || typeof phone !== 'string') {
    res.status(400).json({ success: false, message: "Vui lòng cung cấp số điện thoại hợp lệ." });
    return;
  }

  try {
    const orders = await prisma.order.findMany({
      where: { phone: phone.trim() },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { variant: { include: { product: true } } } } }
    });

    const safeOrders = orders.map(order => {
      const originalCode = order.orderCode.toString();
      // Mask the order code (e.g., 994129180789 -> ***80789)
      const maskedCode = '***' + originalCode.slice(-5);
      return {
        id: order.id,
        orderCode: maskedCode,
        total: order.total,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        paymentUrl: order.paymentUrl,
        trackingCode: order.trackingCode,
        createdAt: order.createdAt,
        items: order.items,
      };
    });

    res.status(200).json({ success: true, data: safeOrders });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống tra cứu." });
  }
};

// ==========================================
// 8. ADMIN: CẬP NHẬT TRẠNG THÁI GIAO HÀNG
// ==========================================
export const updateOrderStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: Number(id) },
        include: { items: true }
      });

      if (!order) {
        throw new Error("Không tìm thấy đơn hàng.");
      }

      // Logic Hoàn kho nếu trạng thái là RETURNED hoặc CANCELLED
      // và trạng thái cũ CHƯA PHẢI là RETURNED hoặc CANCELLED
      if (
        (status === "RETURNED" || status === "CANCELLED") &&
        !(order.status === "RETURNED" || order.status === "CANCELLED")
      ) {
        for (const item of order.items) {
          if (!item.variantId) continue;
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } }
          });
        }
      }

      await tx.order.update({
        where: { id: Number(id) },
        data: { status }
      });
    });

    res.status(200).json({ success: true, message: "Cập nhật trạng thái thành công" });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// ==========================================
// 9. ADMIN: XÁC NHẬN ĐÃ THU TIỀN (CHỈ DÀNH CHO COD)
// ==========================================
export const updatePaymentStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const order = await prisma.order.findUnique({ where: { id: Number(id) } });

    if (!order) {
      res.status(404).json({ success: false, message: "Không tìm thấy đơn hàng." });
      return;
    }

    if (order.paymentMethod !== "COD") {
      res.status(400).json({ success: false, message: "Chỉ có thể xác nhận thu tiền thủ công cho đơn COD." });
      return;
    }

    await prisma.order.update({
      where: { id: Number(id) },
      data: { paymentStatus: "PAID" }
    });

    res.status(200).json({ success: true, message: "Xác nhận đã thu tiền thành công" });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống." });
  }
};
