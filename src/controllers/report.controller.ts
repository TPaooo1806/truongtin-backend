import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getDashboardStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const range = req.query.range as string || 'thisMonth';
    
   // 1. XÁC ĐỊNH KHOẢNG THỜI GIAN 
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();

    if (range === 'today') {
      // Hôm nay: 00:00 -> 23:59
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      
    } else if (range === 'thisWeek') {
      // UX CHUẨN: "7 Ngày Qua" (Lùi về 6 ngày trước + ngày hôm nay)
      startDate.setDate(now.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      
    } else if (range === 'thisMonth') {
      // UX CHUẨN: "30 Ngày Qua" (Biểu đồ luôn đầy đặn)
      startDate.setDate(now.getDate() - 29);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);
      
    } else if (range === 'lastMonth') {
      // Trọn vẹn Tháng Trước (Từ mùng 1 đến ngày cuối tháng)
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      
    } else if (range === 'thisYear') {
      // Năm nay
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate.setHours(23, 59, 59, 999);
    }

    // 2. QUERY DATABASE: Lấy tất cả đơn hàng trong khoảng thời gian
    const orders = await prisma.order.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        status: { not: 'CANCELLED' } // Bỏ qua đơn đã hủy
      },
      include: { items: { include: { variant: { include: { product: true } } } } }
    });

    let totalRevenue = 0;
    let approvedRevenue = 0;
    let pendingRevenue = 0; 
    
    let totalOrdersCount = orders.length;
    let approvedOrdersCount = 0;
    let pendingOrdersCount = 0;

    const chartMap = new Map<string, number>();
    const productMap = new Map<string, number>();

    // 3. XỬ LÝ DỮ LIỆU TỪNG ĐƠN HÀNG
    orders.forEach(order => {
      const isPending = order.status === 'PENDING_COD' || order.status === 'PENDING_PAYOS';
      const isApproved = !isPending; 

      totalRevenue += order.total;
      if (isApproved) {
        approvedRevenue += order.total;
        approvedOrdersCount++;
      } else {
        pendingRevenue += order.total;
        pendingOrdersCount++;
      }

      const dateKey = order.createdAt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
      chartMap.set(dateKey, (chartMap.get(dateKey) || 0) + order.total);

      // Thống kê Top Sản phẩm bán chạy (ĐÃ BỌC AN TOÀN TRÁNH LỖI)
      order.items.forEach(item => {
        const productName = item.variant?.product?.name || "Sản phẩm khác (Đã xóa)";
        productMap.set(productName, (productMap.get(productName) || 0) + item.quantity);
      });
    });

    const chartLabels = Array.from(chartMap.keys());
    const chartData = Array.from(chartMap.values());

    const topProducts = Array.from(productMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // 4. KIỂM TRA TỒN KHO (Sản phẩm sắp hết hàng <= 5)
    const lowStockVariants = await prisma.productVariant.findMany({
      where: { stock: { lte: 5 } }, // Sửa thành 5 theo yêu cầu của bạn
      include: { product: { select: { name: true, category: { select: { name: true } } } } },
      take: 10
    });

    const lowStock = lowStockVariants.map(v => ({
      name: v.product.name + (v.name !== "Mặc định" ? ` (${v.name})` : ""),
      category: v.product.category?.name || "Khác",
      stock: v.stock
    }));

    // =========================================================
    // 5. TẠO DATA THÔNG BÁO (NOTIFICATIONS) CHO NÚT CHUÔNG
    // =========================================================
    const notifications: any[] = [];

    // A. Bơm thông báo Hết Hàng (WARNING)
    lowStockVariants.forEach(v => {
      notifications.push({
        id: `stock-${v.id}`,
        type: 'WARNING',
        title: 'Hàng sắp cạn kho',
        message: `${v.product.name} chỉ còn ${v.stock} sản phẩm. Hãy nhập hàng!`,
        time: new Date(), // Set thời gian hiện tại
        isRead: false,
        link: '/admin/products' // Gợi ý link để Frontend bấm vào chuyển trang
      });
    });

    // B. Bơm thông báo Đơn Mới (INFO)
    const recentNewOrders = await prisma.order.findMany({
      where: { status: { in: ['PENDING_COD', 'PENDING_PAYOS'] } },
      orderBy: { createdAt: 'desc' },
      take: 5 // Lấy 5 đơn mới nhất chưa duyệt
    });

    recentNewOrders.forEach(order => {
      notifications.push({
        id: `order-${order.id}`,
        type: 'INFO',
        title: 'Đơn hàng mới',
        message: `${order.customerName} vừa đặt đơn ${order.orderCode} trị giá ${order.total.toLocaleString('vi-VN')}đ.`,
        time: order.createdAt,
        isRead: false,
        link: '/admin/orders'
      });
    });

    // C. Sắp xếp thông báo: Cái nào mới xảy ra thì đưa lên đầu
    notifications.sort((a, b) => b.time.getTime() - a.time.getTime());

    // 6. TRẢ KẾT QUẢ VỀ CLIENT
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
        revenueChart: { labels: chartLabels.reverse(), data: chartData.reverse() }, 
        topProducts: {
          labels: topProducts.map(p => p[0]),
          data: topProducts.map(p => p[1])
        },
        lowStock,
        notifications // <--- Chìa khóa cho Nút chuông của bạn nằm ở đây!
      }
    });

  } catch (error) {
    console.error("Lỗi lấy thống kê:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi tải báo cáo" });
  }
};