import { Request, Response } from "express";
import prisma from "../lib/prisma";

// ==========================================
// 1. VALIDATE GIỎ HÀNG (STALE DATA CHECK)
// ==========================================
export const validateCart = async (req: Request, res: Response): Promise<void> => {
  const { variantIds } = req.body;

  if (!variantIds || !Array.isArray(variantIds)) {
    res.status(400).json({ success: false, message: "Danh sách variantIds không hợp lệ." });
    return;
  }

  try {
    const variants = await prisma.productVariant.findMany({
      where: {
        id: { in: variantIds.map(id => Number(id)) }
      },
      select: {
        id: true,
        price: true,
        stock: true,
        name: true
      }
    });

    res.status(200).json({
      success: true,
      data: variants
    });
  } catch (error: any) {
    console.error(`[Cart Error] Lỗi validate giỏ hàng: ${error.message}`);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi tải dữ liệu giỏ hàng mới nhất." });
  }
};
