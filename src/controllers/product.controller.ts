import { Request, Response } from 'express';
import prisma from '../config/prisma';

interface VariantInput {
  sku: string;
  price: string | number;
  stock: string | number;
  name?: string; 
  attributeValue?: string;
}

export const getProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const pageStr = Array.isArray(req.query.page) ? req.query.page[0] : req.query.page;
    const limitStr = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    
    const category = req.query.category as string | undefined;
    const q = req.query.q as string | undefined; // Nhận thêm từ khóa tìm kiếm

    const page = parseInt(pageStr as string) || 1;
    const limit = parseInt(limitStr as string) || 12;
    const skip = (page - 1) * limit;

    // TẠO BỘ LỌC ĐỘNG (Lọc theo danh mục HOẶC lọc theo từ khóa tìm kiếm)
    const whereCondition: any = {};
    if (category) {
      whereCondition.category = { slug: category };
    }
    if (q) {
      whereCondition.name = { contains: q.trim(), mode: 'insensitive' }; // Tìm tên chứa từ khóa
    }

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where: whereCondition, // Gắn bộ lọc vào đây
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, slug: true } }, 
          images: true,
          variants: true
        }
      }),
      prisma.product.count({
        where: whereCondition // Gắn bộ lọc vào đếm tổng số
      })
    ]);

    const totalPages = Math.ceil(totalItems / limit);

    res.status(200).json({
      success: true,
      data: products,
      pagination: { currentPage: page, totalPages, totalItems, limit }
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách sản phẩm:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

export const createProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    // FIX: Đã thêm 'unit' vào req.body
    const { name, slug, description, unit, categoryId, variants, images } = req.body;

    const result = await prisma.product.create({
      data: {
        name,
        slug,
        description,
        unit: unit || "Cái", // FIX: Lưu ĐVT vào database, mặc định là "Cái"
        categoryId: parseInt(categoryId),
        variants: {
          create: variants.map((v: VariantInput, index: number) => {
            const variantName = v.attributeValue || v.name || "Mặc định"; 
            return {
              name: variantName, 
              sku: v.sku && v.sku.trim() !== "" ? v.sku : `${slug}-${Date.now()}-${index}`,
              price: parseFloat(v.price as string),
              stock: parseInt(v.stock as string)
            };
          })
        },
        images: {
          create: images.map((url: string) => ({ url }))
        }
      }
    });

    res.status(201).json({ success: true, data: result });
  } catch (error: any) {
    console.error("🚀 Lỗi tạo sản phẩm:", error.message || error); 
    res.status(500).json({ success: false, message: "Lỗi tạo sản phẩm" });
  }
};

export const updateProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const productId = parseInt(idStr as string);
    
    // FIX: Đã thêm 'unit' vào req.body
    const { name, slug, description, unit, categoryId, variants, images } = req.body;

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        name,
        slug,
        description,
        unit: unit || "Cái", // FIX: Lưu ĐVT vào database khi cập nhật
        categoryId: parseInt(categoryId),
        variants: {
          deleteMany: {}, 
          create: variants.map((v: VariantInput, index: number) => {
            const variantName = v.attributeValue || v.name || "Mặc định";
            return {
              name: variantName,
              sku: v.sku && v.sku.trim() !== "" ? v.sku : `${slug}-${Date.now()}-${index}`,
              price: parseFloat(v.price as string),
              stock: parseInt(v.stock as string)
            };
          })
        },
        images: {
          deleteMany: {}, 
          create: images.map((url: string) => ({ url }))
        }
      }
    });

    res.status(200).json({ success: true, message: "Cập nhật thành công", data: updatedProduct });
  } catch (error: any) {
    console.error("🚀 Lỗi cập nhật sản phẩm:", error.message || error);
    res.status(500).json({ success: false, message: "Lỗi cập nhật sản phẩm" });
  }
};

export const deleteProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const idStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const productId = parseInt(idStr as string);
    
    await prisma.$transaction(async (tx) => {
      await tx.productVariant.deleteMany({ where: { productId } });
      await tx.productImage.deleteMany({ where: { productId } });
      await tx.product.delete({ where: { id: productId } });
    });

    res.status(200).json({ success: true, message: "Đã xóa" });
  } catch (error: any) {
    console.error("🚀 Lỗi xóa sản phẩm:", error.message || error);
    res.status(500).json({ success: false, message: "Lỗi khi xóa" });
  }
};

export const getProductBySlug = async (req: Request, res: Response): Promise<void> => {
  try {
    const slugStr = Array.isArray(req.params.slug) ? req.params.slug[0] : req.params.slug;
    const product = await prisma.product.findUnique({
      where: { slug: slugStr as string },
      include: { category: true, images: true, variants: true }
    });
    
    if (!product) {
      res.status(404).json({ success: false, message: "Không tìm thấy" });
      return;
    }
    
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error("Lỗi lấy chi tiết sản phẩm:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};