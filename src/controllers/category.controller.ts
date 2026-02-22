import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    // Sửa lỗi: Ép kiểu query về string để parseInt không báo lỗi
    const pageStr = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitStr = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;

    const page = parseInt(pageStr as string) || 1;
    const limit = parseInt(limitStr as string) || 12;
    const skip = (page - 1) * limit;

    const [categories, totalItems] = await Promise.all([
      prisma.category.findMany({
        skip: skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { products: true } }
        }
      }),
      prisma.category.count()
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      success: true,
      data: categories,
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems,
        limit: limit
      }
    });
  } catch (error) {
    console.error("Lỗi lấy danh mục:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

export const createCategory = async (req: Request, res: Response): Promise<void | Response> => {
  try {
    const { name, slug } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Vui lòng nhập tên và slug" });
    }
    const newCategory = await prisma.category.create({
      data: { name, slug }
    });
    return res.status(201).json({
      success: true,
      message: "Tạo danh mục thành công",
      data: newCategory
    });
  } catch (error) {
    console.error("Lỗi tạo danh mục:", error);
    return res.status(500).json({ success: false, message: "Lỗi server hoặc slug bị trùng" });
  }
};

export const deleteCategory = async (req: Request, res: Response): Promise<void | Response> => {
  try {
    // Sửa lỗi: Đảm bảo id là string trước khi parseInt
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idStr as string);

    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } }
    });

    if (!category) return res.status(404).json({ success: false, message: "Không tìm thấy" });

    if (category._count.products > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Không thể xóa danh mục đang có ${category._count.products} sản phẩm!` 
      });
    }

    await prisma.category.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Xóa thành công" });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};