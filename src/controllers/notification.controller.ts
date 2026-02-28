import { Request, Response } from "express";
import prisma from "../lib/prisma";

export const getAdminNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Lấy Đơn hàng mới (Đang chờ xử lý)
    const pendingOrders = await prisma.order.findMany({
      where: { status: { in: ['PENDING_COD', 'PENDING_PAYOS', 'PAID_PENDING_CONFIRM'] } },
      orderBy: { createdAt: 'desc' },
      take: 10 // Lấy 10 đơn mới nhất cho nhẹ máy
    });

    // 2. Lấy Liên hệ mới (Chưa đọc)
    const pendingContacts = await prisma.contact.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    const notifications = [];

    // Format Đơn hàng thành Notification
    for (const order of pendingOrders) {
      notifications.push({
        id: `order_${order.id}`,
        type: 'ORDER',
        title: 'Đơn hàng mới!',
        message: `Khách hàng ${order.customerName} vừa đặt đơn #${order.orderCode}.`,
        time: order.createdAt,
        isRead: false,
        details: {
          name: order.customerName,
          phone: order.phone,
          orderCode: order.orderCode.toString(),
          total: order.total
        }
      });
    }

    // Format Liên hệ thành Notification
    for (const contact of pendingContacts) {
      notifications.push({
        id: `contact_${contact.id}`,
        type: 'CONTACT',
        title: 'Tin nhắn liên hệ',
        message: `Có lời nhắn mới từ ${contact.name}.`,
        time: contact.createdAt,
        isRead: false,
        details: {
          name: contact.name,
          phone: contact.phone,
          content: contact.message
        }
      });
    }

    // Trộn chung lại và sắp xếp theo thời gian mới nhất lên đầu
    notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    res.status(200).json({ success: true, data: notifications });
  } catch (error: any) {
    console.error(`[Notification Error]: ${error.message}`);
    res.status(500).json({ success: false, message: "Lỗi lấy thông báo." });
  }
};