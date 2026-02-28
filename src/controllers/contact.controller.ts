import { Request, Response } from "express";
import prisma from "../lib/prisma";

// ==========================================
// 1. KHÁCH HÀNG: GỬI TIN NHẮN LIÊN HỆ
// ==========================================
export const submitContact = async (req: Request, res: Response): Promise<void> => {
  const { name, phone, message } = req.body;

  try {
    // Kiểm tra dữ liệu rỗng
    if (!name || !phone || !message) {
      res.status(400).json({ success: false, message: "Vui lòng điền đầy đủ họ tên, số điện thoại và nội dung." });
      return;
    }

    // Lưu thẳng vào Database
    const newContact = await prisma.contact.create({
      data: {
        name: name.trim(),
        phone: phone.trim(),
        message: message.trim(),
      },
    });

    console.log(`[Contact] Có tin nhắn mới từ: ${name} (${phone})`);

    res.status(200).json({ success: true, message: "Gửi liên hệ thành công!", data: newContact });
  } catch (error: any) {
    console.error(`[Contact Error] Lỗi khi lưu liên hệ: ${error.message}`);
    res.status(500).json({ success: false, message: "Lỗi hệ thống, vui lòng thử lại sau." });
  }
};

// ==========================================
// 2. ADMIN: XEM TẤT CẢ TIN NHẮN (Dùng cho mốt làm Admin)
// ==========================================
export const getAllContacts = async (req: Request, res: Response): Promise<void> => {
  try {
    const contacts = await prisma.contact.findMany({
      orderBy: { createdAt: 'desc' } // Mới nhất xếp trên
    });
    res.status(200).json({ success: true, data: contacts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: "Không tải được danh sách liên hệ." });
  }
};