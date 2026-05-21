import { Request, Response } from 'express';
import prisma from '../config/prisma';
import * as XLSX from 'xlsx'; 
import ExcelJS from 'exceljs';

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
    
    // Hỗ trợ lấy theo ID Danh mục trực tiếp (Dành cho chức năng Sản phẩm liên quan)
    const categoryId = req.query.categoryId as string | undefined;
    if (categoryId) {
      whereCondition.categoryId = Number(categoryId);
    }

    // [AUDIT-FIX] Bắt buộc: Loại trừ sản phẩm đang xem ra khỏi danh sách
    const excludeId = req.query.excludeId as string | undefined;
    if (excludeId) {
      whereCondition.id = { not: Number(excludeId) };
    }

   if (q) {
  // Băm từ khóa thành mảng các từ (vd: "ống pvc" -> ["ống", "pvc"])
  const searchWords = q.trim().split(/\s+/);
  
  // Yêu cầu Prisma tìm sản phẩm có chứa TẤT CẢ các từ này
  whereCondition.AND = searchWords.map(word => ({
    name: { contains: word, mode: 'insensitive' }
  }));
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
// 1. API TẢI FORM MẪU EXCEL (BẢN PRO CÓ ĐỊNH DẠNG & DROPDOWN)
// =======================================================
export const getImportTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({ select: { name: true } });
    const workbook = new ExcelJS.Workbook();

    // TẠO SHEET ẨN CHỨA DATA DROPDOWN (Chống lỗi 255 ký tự của Excel)
    const dataSheet = workbook.addWorksheet("Data", { state: 'hidden' });
    categories.forEach((c, index) => {
      dataSheet.getCell(`A${index + 1}`).value = c.name;
    });

    const worksheet = workbook.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 1 }] // Đóng băng Header
    });

    worksheet.columns = [
      { header: 'Tên sản phẩm *', key: 'name', width: 35 },
      { header: 'Danh mục *', key: 'category', width: 25 },
      { header: 'Đơn vị tính', key: 'unit', width: 15 },
      { header: 'Giá bán *', key: 'price', width: 15 },
      { header: 'Tồn kho *', key: 'stock', width: 15 },
      { header: 'Mô tả', key: 'desc', width: 50 },
      { header: 'Link ảnh', key: 'images', width: 30 },
    ];

    // FORMAT HEADER
    const headerRow = worksheet.getRow(1);
    headerRow.height = 30;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 14 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    // DATA MẪU
    worksheet.addRow({
      name: 'Ống nhựa PVC Bình Minh Phi 21',
      category: categories[0]?.name || 'Ống nước',
      unit: 'Cây', price: 25000, stock: 100,
      desc: 'Sản phẩm chính hãng', images: ''
    }).eachCell((cell) => {
      cell.font = { size: 12 };
      cell.alignment = { vertical: 'middle' };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });

    // GÁN DROPDOWN (Trỏ về Sheet ẩn)
    for (let i = 2; i <= 2000; i++) {
      worksheet.getCell(`B${i}`).dataValidation = {
        type: 'list', allowBlank: false,
        formulae: [`Data!$A$1:$A$${categories.length || 1}`],
        showErrorMessage: true, errorTitle: 'Sai danh mục', error: 'Vui lòng chọn danh mục có sẵn!'
      };
      // Validate Số
      worksheet.getCell(`D${i}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] };
      worksheet.getCell(`E${i}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TruongTin_Template_Import.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Lỗi tạo form mẫu:", error);
    res.status(500).json({ success: false, message: "Lỗi server" });
  }
};

// =======================================================
// 2. API XỬ LÝ IMPORT (BATCHING CONCURRENT + NORMALIZE + LIMIT)
// =======================================================
export const importProductsFromExcel = async (req: Request | any, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Vui lòng chọn file Excel" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets["Products"]; 
    
    // Bắt lỗi rủi ro nếu Admin tự ý đổi tên Sheet dưới Excel
    if (!sheet) {
      res.status(400).json({ success: false, message: "File Excel không hợp lệ. Vui lòng không đổi tên Sheet 'Products'!" });
      return;
    }
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    // IMPROVEMENT 3: GIỚI HẠN FILE SIZE & DÒNG
    if (rows.length === 0) {
      res.status(400).json({ success: false, message: "File Excel trống" });
      return;
    }
    if (rows.length > 10000) {
      res.status(400).json({ success: false, message: "File quá lớn! Giới hạn tối đa 10.000 dòng/lần." });
      return;
    }

    const categories = await prisma.category.findMany();
    const categoryMap = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]));
    
    const existingProducts = await prisma.product.findMany({ select: { slug: true } });
    const existingSlugs = new Set(existingProducts.map(p => p.slug));

    // IMPROVEMENT 2: LÀM SẠCH VÀ CHUẨN HÓA INPUT
    const cleanStr = (str: any) => str ? str.toString().replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';
    const generateSlug = (str: string) => cleanStr(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    let successCount = 0;
    let errors: any[] = [];
    const validPayloads: any[] = [];

    // BƯỚC 1: KIỂM TRA TOÀN BỘ DATA ĐỂ ĐƯA VÀO HÀNG ĐỢI
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; 

      const name = cleanStr(row["Tên sản phẩm *"]);
      const catName = cleanStr(row["Danh mục *"]).toLowerCase();
      const unit = cleanStr(row["Đơn vị tính"]) || "Cái";
      const price = Number(row["Giá bán *"]) || 0;
      const stock = Number(row["Tồn kho *"]) || 0;
      const description = cleanStr(row["Mô tả"]);
      const imagesStr = cleanStr(row["Link ảnh"]);

      if (!name) { errors.push({ row: rowNumber, reason: "Thiếu tên sản phẩm" }); continue; }
      
      const categoryId = categoryMap.get(catName);
      if (!categoryId) { errors.push({ row: rowNumber, reason: `Danh mục '${row["Danh mục *"]}' không tồn tại` }); continue; }
      if (price <= 0) { errors.push({ row: rowNumber, reason: "Giá bán phải lớn hơn 0" }); continue; }

      const slug = generateSlug(name);
      if (existingSlugs.has(slug)) { errors.push({ row: rowNumber, reason: `Sản phẩm đã tồn tại (Trùng tên)` }); continue; }

      // Ghi nhận trước để check trùng các dòng bên dưới trong cùng 1 file Excel
      existingSlugs.add(slug); 

      const randomSku = `SP-${Date.now().toString().slice(-5)}-${Math.floor(Math.random() * 1000)}`;
      const imagesArray = imagesStr ? imagesStr.split(';').map((url: string) => ({ url: url.trim() })).filter((img: any) => img.url) : [];

      validPayloads.push({
        rowNumber,
        data: {
          name, slug, description, unit, categoryId,
          variants: { create: [{ name: "Mặc định", sku: randomSku, price, stock }] },
          images: { create: imagesArray }
        }
      });
    }

    // BƯỚC 2: IMPROVEMENT 1 - BATCH INSERT CONCURRENT (Chạy song song 50 lệnh)
    const CHUNK_SIZE = 50;
    for (let i = 0; i < validPayloads.length; i += CHUNK_SIZE) {
      const chunk = validPayloads.slice(i, i + CHUNK_SIZE);
      
      // Khởi tạo các Promise chạy độc lập
      const promises = chunk.map(item => 
        prisma.product.create({ data: item.data })
          .then(() => ({ status: 'fulfilled', rowNumber: item.rowNumber }))
          .catch((err) => ({ status: 'rejected', rowNumber: item.rowNumber, error: err }))
      );

      // Chờ toàn bộ 50 lệnh trong Chunk này chạy xong
      const results = await Promise.all(promises);

      results.forEach(result => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else if (result.status === 'rejected' && 'error' in result) {
          console.error(`Lỗi DB dòng ${result.rowNumber}:`, result.error);
          errors.push({ row: result.rowNumber, reason: "Lỗi hệ thống khi lưu (Kiểm tra lại định dạng/ký tự lạ)" });
        }
      });
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
