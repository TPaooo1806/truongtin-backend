import { Request, Response } from 'express';
import prisma from '../lib/prisma';

// 1. LẤY DANH SÁCH BANNER
export const getBanners = async (req: Request, res: Response) => {
  try {
    const banners = await prisma.banner.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: banners });
  } catch (error) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi lấy banner" });
  }
};

// 2. LẤY BANNER ĐANG HOẠT ĐỘNG (Dành cho trang chủ của Khách)
export const getActiveBanners = async (req: Request, res: Response) => {
  try {
    const { position } = req.query;
    const whereClause: any = { isActive: true };
    
    // Nếu có truyền position thì lọc theo vị trí
    if (position) {
      whereClause.position = String(position);
    }
    
    const banners = await prisma.banner.findMany({ 
      where: whereClause, 
      orderBy: { createdAt: 'desc' } 
    });
    res.json({ success: true, data: banners });
  } catch (error) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi lấy banner hoạt động" });
  }
};

// 3. THÊM BANNER MỚI
export const createBanner = async (req: Request, res: Response) => {
  try {
    const { title, imageUrl, link, position } = req.body;
    const newBanner = await prisma.banner.create({
      data: { 
        title, 
        imageUrl, 
        link: link || "",
        position: position || "HOME_MAIN"
      } as any
    });
    res.json({ success: true, data: newBanner });
  } catch (error) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi tạo banner" });
  }
};

// 4. ĐỔI TRẠNG THÁI (BẬT/TẮT)
export const toggleBanner = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    await prisma.banner.update({
      where: { id: Number(id) },
      data: { isActive }
    });
    res.json({ success: true, message: "Cập nhật thành công" });
  } catch (error) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi cập nhật banner" });
  }
};

// 5. XÓA BANNER
export const deleteBanner = async (req: Request, res: Response) => {
  try {
    await prisma.banner.delete({ where: { id: Number(req.params.id) } });
    res.json({ success: true, message: "Đã xóa banner" });
  } catch (error) {
    console.error("Lỗi:", error);
    res.status(500).json({ success: false, message: "Lỗi xóa banner" });
  }
};
