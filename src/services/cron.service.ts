import prisma from "../config/prisma";

/**
 * Quét và tự động hủy các đơn hàng UNPAID quá 12 tiếng.
 * Được kích hoạt On-Demand khi người dùng hoặc Admin mở danh sách/chi tiết đơn hàng.
 * TUYỆT ĐỐI KHÔNG dùng setInterval để tránh đánh thức database Neon liên tục.
 */
export const checkAndCancelExpiredOrders = async (): Promise<number> => {
  try {
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);

    // Tìm các đơn hàng UNPAID quá 12 tiếng
    const expiredOrders = await prisma.order.findMany({
      where: {
        paymentStatus: "UNPAID",
        createdAt: {
          lt: twelveHoursAgo,
        },
      },
      include: { items: true },
    });

    if (expiredOrders.length === 0) {
      return 0;
    }

    for (const order of expiredOrders) {
      await prisma.$transaction(async (tx) => {
        // Trả lại tồn kho
        for (const item of order.items) {
          if (!item.variantId) continue;
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: { stock: { increment: item.quantity } },
          });
        }

        // Cập nhật trạng thái đơn
        await tx.order.update({
          where: { id: order.id },
          data: {
            status: "CANCELLED" as any,
            paymentStatus: "EXPIRED",
          },
        });
      });

      console.log(`[Order Service] Đã tự động hủy đơn hàng #${order.orderCode} (Hết hạn thanh toán quá 12h).`);
    }

    console.log(`[Order Service] Hoàn tất quét đơn quá hạn. Đã xử lý ${expiredOrders.length} đơn.`);
    return expiredOrders.length;
  } catch (error) {
    console.error("[Order Service] Lỗi khi kiểm tra đơn hàng quá hạn:", error);
    return 0;
  }
};
