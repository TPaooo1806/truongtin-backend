import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const suggestProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query.q as string;
    if (!q || q.trim() === '') {
       res.status(200).json([]);
       return;
    }

    // Tìm trong database 6 sản phẩm có chứa từ khóa
    const products = await prisma.product.findMany({
      where: {
        name: { contains: q.trim(), mode: 'insensitive' } // insensitive: Không phân biệt hoa thường
      },
      select: { name: true }, // Chỉ lấy cái tên cho nhẹ
      take: 6
    });

    // Lọc ra mảng chữ (array of strings) như bạn yêu cầu
    const suggestions = products.map(p => p.name);

    res.status(200).json(suggestions);
  } catch (error) {
    console.error("Lỗi API Suggest:", error);
    res.status(500).json([]);
  }
};