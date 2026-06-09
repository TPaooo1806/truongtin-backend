import prisma from "../config/prisma";

export const startCronJobs = () => {
  // Chạy mỗi 1 tiếng (3600000 ms)
  setInterval(async () => {
    try {
      console.log("[Cron] Bắt đầu quét đơn hàng quá hạn...");
      
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
        console.log("[Cron] Không có đơn hàng nào quá hạn.");
        return;
      }

      for (const order of expiredOrders) {
        await prisma.$transaction(async (tx) => {
          // Trả lại kho
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

        console.log(`[Cron] Đã hủy đơn hàng #${order.orderCode} (Hết hạn thanh toán).`);
      }
      console.log(`[Cron] Hoàn tất quét đơn hàng. Đã xử lý ${expiredOrders.length} đơn.`);
    } catch (error) {
      console.error("[Cron] Lỗi khi quét đơn hàng quá hạn:", error);
    }
  }, 3600000); // 1 giờ
};
