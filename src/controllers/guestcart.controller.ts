import { Request, Response } from "express";
import prisma from "../lib/prisma";

// ==========================================
// 1. LƯU HOẶC CẬP NHẬT GIỎ HÀNG TẠM
// ==========================================
export const saveGuestCart = async (req: Request, res: Response): Promise<void> => {
  const { phone, cartData } = req.body;

  if (!phone || !cartData) {
    res.status(400).json({ success: false, message: "Thiếu số điện thoại hoặc dữ liệu giỏ hàng." });
    return;
  }

  try {
    const upsertedCart = await prisma.guestCart.upsert({
      where: { phone },
      update: { cartData },
      create: { phone, cartData }
    });

    res.status(200).json({
      success: true,
      message: "Đã lưu toa hàng thành công vào hệ thống.",
      data: upsertedCart
    });
  } catch (error: any) {
    console.error(`[GuestCart Error] Lỗi lưu giỏ hàng: ${error.message}`);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi lưu giỏ hàng." });
  }
};

// ==========================================
// 2. TẢI LẠI GIỎ HÀNG TẠM BẰNG SỐ ĐIỆN THOẠI
// ==========================================
export const getGuestCart = async (req: Request, res: Response): Promise<void> => {
  const phone = req.params.phone as string;

  try {
    const cart = await prisma.guestCart.findUnique({
      where: { phone }
    });

    if (!cart) {
      res.status(404).json({ success: false, message: "Không tìm thấy toa hàng lưu tạm nào cho số điện thoại này." });
      return;
    }

    res.status(200).json({ success: true, data: cart });
  } catch (error: any) {
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi tải giỏ hàng." });
  }
};
