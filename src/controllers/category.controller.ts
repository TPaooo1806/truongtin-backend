import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { triggerRevalidate } from '../lib/revalidate';

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
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
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
    const { name, slug, showOnHome, displayOrder } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Vui lòng nhập tên và slug" });
    }
    const newCategory = await prisma.category.create({
      data: { 
        name, 
        slug,
        showOnHome: showOnHome === true || showOnHome === 'true',
        displayOrder: displayOrder !== undefined ? parseInt(displayOrder) : 0
      }
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
    
    triggerRevalidate('/'); // Cập nhật lại trang chủ nếu danh mục bị xóa
    return res.status(200).json({ success: true, message: "Xóa thành công" });
  } catch (error) {
    console.error("Lỗi:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

export const updateCategory = async (req: Request, res: Response): Promise<void | Response> => {
  try {
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idStr as string);
    const { name, slug, showOnHome, displayOrder } = req.body;

    const dataToUpdate: any = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (slug !== undefined) dataToUpdate.slug = slug;
    if (showOnHome !== undefined) dataToUpdate.showOnHome = showOnHome === true || showOnHome === 'true';
    if (displayOrder !== undefined) dataToUpdate.displayOrder = parseInt(displayOrder) || 0;

    const updatedCategory = await prisma.category.update({
      where: { id },
      data: dataToUpdate
    });

    // Ép xóa cache trang chủ
    triggerRevalidate('/');

    return res.status(200).json({
      success: true,
      message: "Cập nhật danh mục thành công",
      data: updatedCategory
    });
  } catch (error) {
    console.error("Lỗi cập nhật danh mục:", error);
    return res.status(500).json({ success: false, message: "Lỗi server hoặc dữ liệu không hợp lệ" });
  }
};