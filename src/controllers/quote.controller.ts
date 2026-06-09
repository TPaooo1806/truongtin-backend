import { Request, Response } from "express";
import prisma from "../lib/prisma";

// ==========================================
// 1. TẠO BÁO GIÁ ZALO (QUOTE REQUEST)
// ==========================================
export const createQuote = async (req: Request, res: Response): Promise<void> => {
  const { customerName, phone, items } = req.body;

  if (!phone || !items || !items.length) {
    res.status(400).json({ success: false, message: "Thiếu thông tin bắt buộc (Số điện thoại hoặc Giỏ hàng)." });
    return;
  }

  try {
    // Tự động sinh mã đơn (BG = Báo Giá)
    const quoteCode = `BG-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

    const newQuote = await prisma.quoteRequest.create({
      data: {
        code: quoteCode,
        customerName: customerName || "Khách hàng Zalo",
        phone,
        items, // JSON array
        status: "PENDING"
      }
    });

    res.status(200).json({
      success: true,
      message: "Tạo yêu cầu báo giá thành công.",
      code: newQuote.code
    });
  } catch (error: any) {
    console.error(`[Quote Error] Lỗi tạo báo giá: ${error.message}`);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi tạo báo giá." });
  }
};

// ==========================================
// 2. LẤY CHI TIẾT BÁO GIÁ BẰNG MÃ CODE (Cho Admin)
// ==========================================
export const getQuoteByCode = async (req: Request, res: Response): Promise<void> => {
  const code = req.params.code as string;

  try {
    const quote = await prisma.quoteRequest.findUnique({
      where: { code }
    });

    if (!quote) {
      res.status(404).json({ success: false, message: "Không tìm thấy yêu cầu báo giá này." });
      return;
    }

    res.status(200).json({ success: true, data: quote });
  } catch (error: any) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi tra cứu báo giá." });
  }
};
