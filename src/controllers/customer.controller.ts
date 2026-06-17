import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getCustomers = async (req: Request, res: Response) => {
  try {
    const customers = await prisma.user.findMany({
      include: {
        _count: {
          select: { orders: true }
        },
        orders: {
          select: { total: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const formattedCustomers = customers.map(user => {
      const spent = user.orders.reduce((sum, order) => sum + order.total, 0);
      return {
        id: user.id,
        name: user.name || 'Khách vãng lai',
        phone: user.phone,
        email: user.email,
        customerType: user.customerType,
        spent: spent,
        ordersCount: user._count.orders,
        joined: user.createdAt.toISOString()
      };
    });

    res.json({ success: true, data: formattedCustomers });
  } catch (error) {
    console.error("Lỗi lấy khách hàng:", error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};

export const updateCustomerType = async (req: Request, res: Response) => {
  try {
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { customerType } = req.body;

    const user = await prisma.user.update({
      where: { id: parseInt(idStr as string) },
      data: { customerType }
    });

    res.json({ success: true, message: 'Cập nhật loại khách hàng thành công', data: user });
  } catch (error) {
    console.error("Lỗi cập nhật khách hàng:", error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
