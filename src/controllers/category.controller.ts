import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { triggerRevalidate } from '../lib/revalidate';

export const getCategories = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageStr = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitStr = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const adminStr = Array.isArray(req.query.admin) ? req.query.admin[0] : req.query.admin;
    const includeInactiveStr = Array.isArray(req.query.includeInactive) ? req.query.includeInactive[0] : req.query.includeInactive;

    const isAdmin = adminStr === 'true' || includeInactiveStr === 'true';

    // Điều kiện lọc: Admin xem toàn bộ, Khách vãng lai chỉ xem danh mục đang Kích Hoạt (isActive: true)
    const whereCondition = isAdmin ? {} : { isActive: true };

    // Nếu không truyền page/limit (như Header, Sidebar ngoài frontend) hoặc truyền all=true -> lấy tất cả
    const isFetchAll = (!pageStr && !limitStr) || req.query.all === 'true';

    if (isFetchAll) {
      const categories = await prisma.category.findMany({
        where: whereCondition,
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { products: true } }
        }
      });

      res.status(200).json({
        success: true,
        data: categories,
        total: categories.length
      });
      return;
    }

    const page = parseInt(pageStr as string) || 1;
    const limit = parseInt(limitStr as string) || 12;
    const skip = (page - 1) * limit;

    const [categories, totalItems] = await Promise.all([
      prisma.category.findMany({
        where: whereCondition,
        skip: skip,
        take: limit,
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { products: true } }
        }
      }),
      prisma.category.count({ where: whereCondition })
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
    const { name, slug, icon, showOnHome, isActive, displayOrder } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Vui lòng nhập tên và slug" });
    }
    const newCategory = await prisma.category.create({
      data: { 
        name, 
        slug,
        icon: icon || 'bi-tag',
        showOnHome: showOnHome === true || showOnHome === 'true',
        isActive: isActive !== undefined ? (isActive === true || isActive === 'true') : true,
        displayOrder: displayOrder !== undefined ? parseInt(displayOrder) : 0
      }
    });

    triggerRevalidate('/');

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
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idStr as string);

    const category = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } }
    });

    if (!category) return res.status(404).json({ success: false, message: "Không tìm thấy danh mục" });

    // Chặn tuyệt đối nếu danh mục đang chứa sản phẩm
    if (category._count.products > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Danh mục đang có ${category._count.products} sản phẩm. Vui lòng chuyển các sản phẩm sang danh mục khác trước khi xóa!` 
      });
    }

    await prisma.category.delete({ where: { id } });
    
    triggerRevalidate('/'); // Cập nhật lại trang chủ nếu danh mục bị xóa
    return res.status(200).json({ success: true, message: "Xóa danh mục thành công" });
  } catch (error) {
    console.error("Lỗi xóa danh mục:", error);
    return res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

export const updateCategory = async (req: Request, res: Response): Promise<void | Response> => {
  try {
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const id = parseInt(idStr as string);
    const { name, slug, icon, showOnHome, isActive, displayOrder } = req.body;

    const dataToUpdate: any = {};
    if (name !== undefined) dataToUpdate.name = name;
    if (slug !== undefined) dataToUpdate.slug = slug;
    if (icon !== undefined) dataToUpdate.icon = icon;
    if (showOnHome !== undefined) dataToUpdate.showOnHome = showOnHome === true || showOnHome === 'true';
    if (isActive !== undefined) dataToUpdate.isActive = isActive === true || isActive === 'true';
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
