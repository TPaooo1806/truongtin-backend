import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = req.query.range as string || 'thisMonth';
    
    // 1. XÁC ĐỊNH KHOẢNG THỜI GIAN (Date Range)
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    if (range === 'today') {
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (range === 'thisWeek') {
      const day = now.getDay() || 7; 
      startDate.setDate(now.getDate() - day + 1);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (range === 'thisMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (range === 'lastMonth') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (range === 'thisYear') {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
    }

    // 2. QUERY DATABASE: Lấy tất cả đơn hàng trong khoảng thời gian
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: { not: 'CANCELLED' } // Bỏ qua đơn đã hủy
      },
      include: { items: { include: { variant: { include: { product: true } } } } }
    });

    // Khởi tạo các biến chứa kết quả
    let totalRevenue = 0;
    let approvedRevenue = 0; // Đã thanh toán (PayOS) hoặc Admin duyệt
    let pendingRevenue = 0;  // Chờ duyệt
    
    let totalOrdersCount = orders.length;
    let approvedOrdersCount = 0;
    let pendingOrdersCount = 0;

    // Dữ liệu cho Biểu đồ Đường (Doanh thu theo ngày/tháng)
    const chartMap = new Map<string, number>();

    // Dữ liệu cho Biểu đồ Cột (Top sản phẩm)
    const productMap = new Map<string, number>();

    // 3. XỬ LÝ DỮ LIỆU TỪNG ĐƠN HÀNG
    orders.forEach(order => {
      // Phân loại trạng thái (Dựa vào code tạo đơn của bạn)
      const isPending = order.status === 'PENDING_COD' || order.status === 'PENDING_PAYOS';
      const isApproved = !isPending; // Các trạng thái PAID, APPROVED, DELIVERED...

      // Cộng dồn Doanh thu
      totalRevenue += order.total;
      if (isApproved) {
        approvedRevenue += order.total;
        approvedOrdersCount++;
      } else {
        pendingRevenue += order.total;
        pendingOrdersCount++;
      }

      // Nhóm dữ liệu cho Biểu đồ Đường (Ví dụ: "Ngày 15/10")
      const dateKey = order.createdAt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      chartMap.set(dateKey, (chartMap.get(dateKey) || 0) + order.total);

      // Thống kê Top Sản phẩm bán chạy (Cộng dồn số lượng)
      order.items.forEach(item => {
        const productName = item.variant.product.name;
        productMap.set(productName, (productMap.get(productName) || 0) + item.quantity);
      });
    });

    // Format dữ liệu biểu đồ gửi về Frontend
    const chartLabels = Array.from(chartMap.keys());
    const chartData = Array.from(chartMap.values());

    // Sort và lấy Top 5 sản phẩm bán chạy nhất
    const topProducts = Array.from(productMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // 4. KIỂM TRA TỒN KHO (Sản phẩm sắp hết hàng < 10)
    const lowStockVariants = await prisma.productVariant.findMany({
      where: { stock: { lte: 10 } },
      include: { product: { select: { name: true, category: { select: { name: true } } } } },
      take: 10
    });

    const lowStock = lowStockVariants.map(v => ({
      name: v.product.name + (v.name !== "Mặc định" ? ` (${v.name})` : ""),
      category: v.product.category?.name || "Khác",
      stock: v.stock
    }));

    // Trả kết quả về cho Frontend
    res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRevenue,
          approvedRevenue,
          pendingRevenue,
          totalOrdersCount,
          approvedOrdersCount,
          pendingOrdersCount,
        },
        revenueChart: { labels: chartLabels.reverse(), data: chartData.reverse() }, // Reverse để ngày cũ đứng trước
        topProducts: {
          labels: topProducts.map(p => p[0]),
          data: topProducts.map(p => p[1])
        },
        lowStock
      }
    });

  } catch (error) {
    console.error("Lỗi lấy thống kê:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi tải báo cáo" });
  }
};