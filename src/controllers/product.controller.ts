import { Request, Response } from 'express';
import prisma from '../config/prisma';
import * as XLSX from 'xlsx'; // <-- ĐÃ THÊM THƯ VIỆN ĐỌC EXCEL

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
    const q = req.query.q as string | undefined;

    const page = parseInt(pageStr as string) || 1;
    const limit = parseInt(limitStr as string) || 12;
    const skip = (page - 1) * limit;

    const whereCondition: any = {};
    if (category) {
      whereCondition.category = { slug: category };
    }
    if (q) {
      whereCondition.name = { contains: q.trim(), mode: 'insensitive' };
    }

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where: whereCondition,
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
        where: whereCondition
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
    const { name, slug, description, unit, categoryId, variants, images } = req.body;

    const result = await prisma.product.create({
      data: {
        name,
        slug,
        description,
        unit: unit || "Cái",
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
    
    const { name, slug, description, unit, categoryId, variants, images } = req.body;

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        name,
        slug,
        description,
        unit: unit || "Cái",
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

// =======================================================
// ĐÃ THÊM: HÀM TẢI FORM MẪU EXCEL
// =======================================================
export const getImportTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const templateData = [
      {
        "Tên sản phẩm": "Ống nhựa PVC Bình Minh Phi 21",
        "Danh mục": "Ống nước",
        "Đơn vị tính": "Cây",
        "Giá bán": 25000,
        "Tồn kho": 100,
        "Mô tả": "Sản phẩm chính hãng",
        "Link ảnh": "" // Để trống theo yêu cầu của bạn
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="TruongTin_Template_Import.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error("Lỗi tạo form mẫu:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// =======================================================
// ĐÃ THÊM: HÀM XỬ LÝ IMPORT FILE EXCEL
// =======================================================
export const importProductsFromExcel = async (req: Request | any, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Vui lòng chọn file Excel" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      res.status(400).json({ success: false, message: "File Excel trống" });
      return;
    }

    // Lấy trước dữ liệu Category và Slug để tra cứu nhanh
    const categories = await prisma.category.findMany();
    const categoryMap = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]));
    
    const existingProducts = await prisma.product.findMany({ select: { slug: true } });
    const existingSlugs = new Set(existingProducts.map(p => p.slug));

    let successCount = 0;
    let errors: any[] = [];

    const generateSlug = (str: string) => {
      return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    };

    // Lặp qua từng dòng để lưu
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; 

      const name = row["Tên sản phẩm"]?.toString().trim();
      const catName = row["Danh mục"]?.toString().trim().toLowerCase();
      const unit = row["Đơn vị tính"]?.toString().trim() || "Cái";
      const price = Number(row["Giá bán"]) || 0;
      const stock = Number(row["Tồn kho"]) || 0;
      const description = row["Mô tả"]?.toString() || "";
      const imagesStr = row["Link ảnh"]?.toString() || "";

      if (!name) {
        errors.push({ row: rowNumber, reason: "Thiếu tên sản phẩm" });
        continue;
      }

      const categoryId = categoryMap.get(catName);
      if (!categoryId) {
        errors.push({ row: rowNumber, reason: `Danh mục '${row["Danh mục"]}' không tồn tại` });
        continue;
      }

      const slug = generateSlug(name);
      if (existingSlugs.has(slug)) {
        errors.push({ row: rowNumber, reason: `Sản phẩm đã tồn tại (Trùng tên)` });
        continue;
      }

      // Tự động tạo SKU ngẫu nhiên
      const randomSku = `SP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;

      const imagesArray = imagesStr 
        ? imagesStr.split(';').map((url: string) => ({ url: url.trim() })).filter((img: any) => img.url)
        : [];

      try {
        await prisma.product.create({
          data: {
            name,
            slug,
            description,
            unit,
            categoryId,
            variants: {
              create: [{
                name: "Mặc định",
                sku: randomSku,
                price,
                stock
              }]
            },
            images: {
              create: imagesArray
            }
          }
        });
        
        existingSlugs.add(slug);
        successCount++;
      } catch (err) {
        console.error(`Lỗi dòng ${rowNumber}:`, err);
        errors.push({ row: rowNumber, reason: "Lỗi lưu Database (Sai định dạng chữ/số)" });
      }
    }

    res.status(200).json({
      success: true,
      data: { successCount, failedCount: errors.length, errors }
    });

  } catch (error) {
    console.error("Lỗi Import Excel:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi xử lý file" });
  }
};