import { Request, Response } from 'express';
import prisma from '../config/prisma';
import * as XLSX from 'xlsx'; 
import ExcelJS from 'exceljs';
import { triggerRevalidate } from '../lib/revalidate';

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
    const { name, slug, description, unit, categoryId, variants, images, attributes, isBulky } = req.body;

    const result = await prisma.product.create({
      data: {
        name,
        slug,
        description,
        unit: unit || "Cái",
        categoryId: parseInt(categoryId),
        isBulky: isBulky === true || isBulky === 'true',
        attributes: attributes ? JSON.parse(JSON.stringify(attributes)) : null,
        variants: {
          create: variants.map((v: VariantInput, index: number) => {
            const variantName = v.attributeValue || v.name || "Mặc định"; 
            return {
              name: variantName, 
              sku: v.sku && v.sku.trim() !== "" ? v.sku : `${slug}-${Date.now()}-${index}`,
              price: v.price ? (parseFloat(v.price as string) || 0) : 0,
              stock: v.stock ? (parseInt(v.stock as string) || 0) : 0
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
    
    const { name, slug, description, unit, categoryId, variants, images, attributes, isBulky } = req.body;

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        name,
        slug,
        description,
        unit: unit || "Cái",
        categoryId: parseInt(categoryId),
        isBulky: isBulky === true || isBulky === 'true',
        attributes: attributes ? JSON.parse(JSON.stringify(attributes)) : null,
        variants: {
          deleteMany: {}, 
          create: variants.map((v: VariantInput, index: number) => {
            const variantName = v.attributeValue || v.name || "Mặc định";
            return {
              name: variantName,
              sku: v.sku && v.sku.trim() !== "" ? v.sku : `${slug}-${Date.now()}-${index}`,
              price: v.price ? (parseFloat(v.price as string) || 0) : 0,
              stock: v.stock ? (parseInt(v.stock as string) || 0) : 0
            };
          })
        },
        images: {
          deleteMany: {}, 
          create: images.map((url: string) => ({ url }))
        }
      }
    });

    // Ép Next.js xóa cache trang chi tiết sản phẩm này
    await triggerRevalidate(`/product/${slug}`);

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

    const sampleCat = categories[0]?.name || 'Bóng đèn';

    // DATA MẪU - SP đơn giản
    const formatRow = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.font = { size: 12 };
        cell.alignment = { vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    };
    formatRow(worksheet.addRow({
      name: 'Ống nhựa PVC Bình Minh Phi 21',
      category: sampleCat,
      unit: 'Cây', price: 25000, stock: 100,
      desc: 'Sản phẩm chính hãng', images: ''
    }));

    formatRow(worksheet.addRow({
      name: 'Bóng đèn LED MPE 3W', 
      category: sampleCat,
      unit: 'Cái', price: 15000, stock: 50,
      desc: 'Bóng LED tiết kiệm điện', images: 'bongden-mpe.jpg'
    }));

    // GÁN DROPDOWN (Trỏ về Sheet ẩn) - Cột B vẫn là Danh mục
    for (let i = 2; i <= 2000; i++) {
      worksheet.getCell(`B${i}`).dataValidation = {
        type: 'list', allowBlank: false,
        formulae: [`Data!$A$1:$A$${categories.length || 1}`],
        showErrorMessage: true, errorTitle: 'Sai danh mục', error: 'Vui lòng chọn danh mục có sẵn!'
      };
      // Validate Số - Cột D (Giá bán) và E (Tồn kho)
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

    // Lấy imagesMap từ Frontend gửi lên (nếu có)
    const imagesMapStr = req.body.imagesMap;
    let imagesMap: Record<string, string> = {};
    try {
      if (imagesMapStr) {
        imagesMap = JSON.parse(imagesMapStr);
      }
    } catch(e) {
      console.error("Invalid imagesMap JSON");
    }

    // Hàm chuẩn hóa tên file siêu cấp (Xóa bỏ mọi khoảng trắng, dấu gạch ngang, ký tự đặc biệt)
    const normalizeFileName = (name: string) => {
      return name
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "") // Xóa bỏ đuôi file để so khớp độc lập định dạng
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Bỏ dấu tiếng Việt
        .replace(/[^a-z0-9]/g, "") // Xóa mọi khoảng trắng, dấu gạch ngang, underscore...
        .trim();
    };

    // Chuẩn hóa key của imagesMap
    const normalizedImagesMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(imagesMap)) {
      normalizedImagesMap[normalizeFileName(key)] = value;
    }

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

    // Hàm tự động viết hoa chữ cái đầu mỗi từ (Title Case)
    const capitalizeFirst = (str: string) => {
      if (!str) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    // Hàm parse giá tiền thông minh (chấp nhận dấu phẩy, dấu chấm, hoặc để trống = 0)
    const parsePrice = (raw: any): number => {
      if (raw === undefined || raw === null || raw === '') return 0;
      if (typeof raw === 'number') return raw;
      return Number(raw.toString().replace(/[,.]/g, '')) || 0;
    };

    let successCount = 0;
    let errors: any[] = [];
    let warnings: any[] = [];

    // ===================================================================
    // BƯỚC 1: XÂY DỰNG PAYLOAD TỪ TỪNG DÒNG EXCEL
    // ===================================================================
    const validPayloads: { rowNumber: number; data: any }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // Dòng 1 là header, dữ liệu bắt đầu từ dòng 2

      const rawName = cleanStr(row["Tên sản phẩm *"]);
      if (!rawName) { errors.push({ row: rowNumber, reason: "Thiếu tên sản phẩm" }); continue; }

      // Tự động viết hoa chữ cái đầu
      const name = capitalizeFirst(rawName);

      const catName = cleanStr(row["Danh mục *"]).toLowerCase();
      const unit = cleanStr(row["Đơn vị tính"]) || "Cái";
      const price = parsePrice(row["Giá bán *"]);
      const stock = Number(row["Tồn kho *"]) || 0;
      const description = cleanStr(row["Mô tả"]);
      const imagesStr = cleanStr(row["Link ảnh"]);

      if (price < 0) { errors.push({ row: rowNumber, reason: "Giá bán không được âm" }); continue; }

      const categoryId = categoryMap.get(catName);
      if (!categoryId) { errors.push({ row: rowNumber, reason: `Danh mục '${row["Danh mục *"]}' không tồn tại` }); continue; }

      const slug = generateSlug(name);

      // Kiểm tra trùng tên với Database (kể cả những slug đã thêm trong đợt này)
      if (existingSlugs.has(slug)) {
        errors.push({ row: rowNumber, reason: `Sản phẩm '${name}' đã tồn tại (Trùng tên)` });
        continue;
      }
      existingSlugs.add(slug);

      // Xử lý chuỗi Link ảnh
      const imagesArray: { url: string }[] = [];
      if (imagesStr) {
        const parts = imagesStr.split(';');
        for (const part of parts) {
          const urlOrName = part.trim();
          if (!urlOrName) continue;

          if (urlOrName.startsWith('http://') || urlOrName.startsWith('https://')) {
            imagesArray.push({ url: urlOrName });
          } else {
            const normName = normalizeFileName(urlOrName);
            const cloudUrl = normalizedImagesMap[normName];
            if (cloudUrl) {
              imagesArray.push({ url: cloudUrl });
            } else {
              warnings.push({ row: rowNumber, name, reason: `Không tìm thấy file ảnh tương ứng: ${urlOrName}` });
            }
          }
        }
      }

      // Tạo mảng Variants (Mỗi sản phẩm có 1 biến thể mặc định)
      const sku = `SP-${Date.now().toString().slice(-6)}-${rowNumber}-${Math.floor(Math.random() * 1000)}`;
      const variantsCreate = [
        { name: "Mặc định", sku, price, stock }
      ];

      validPayloads.push({
        rowNumber,
        data: {
          name,
          slug,
          description,
          unit,
          categoryId,
          variants: { create: variantsCreate },
          images: { create: imagesArray },
        }
      });
    }

    // ===================================================================
    // BƯỚC 3: BATCH INSERT CONCURRENT (Chạy song song 50 lệnh)
    // ===================================================================
    const CHUNK_SIZE = 50;
    for (let i = 0; i < validPayloads.length; i += CHUNK_SIZE) {
      const chunk = validPayloads.slice(i, i + CHUNK_SIZE);
      
      const promises = chunk.map(item => 
        prisma.product.create({ data: item.data })
          .then(() => ({ status: 'fulfilled', rowNumber: item.rowNumber }))
          .catch((err) => ({ status: 'rejected', rowNumber: item.rowNumber, error: err }))
      );

      const results = await Promise.all(promises);

      results.forEach(result => {
        if (result.status === 'fulfilled') {
          successCount++;
        } else if (result.status === 'rejected' && 'error' in result) {
          console.error(`Lỗi DB dòng ${result.rowNumber}:`, result.error);
          
          let errDetail = "Lỗi không xác định";
          if (result.error instanceof Error) {
            errDetail = result.error.message.split('\n').pop() || result.error.message;
          } else if (typeof result.error === 'string') {
            errDetail = result.error;
          }
          
          errors.push({ row: result.rowNumber, reason: `Lỗi lưu DB: ${errDetail}` });
        }
      });
    }

    res.status(200).json({
      success: true,
      data: { successCount, failedCount: errors.length, errors, warnings }
    });

  } catch (error) {
    console.error("Lỗi Import Excel:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi xử lý file" });
  }
};

export const getHomeData = async (req: Request, res: Response): Promise<void> => {
  try {
    // 1. Lấy danh sách ID sản phẩm bán chạy nhất từ OrderItem
    const topSoldResult = await prisma.$queryRaw<{id: number, total_sold: number}[]>`
      SELECT p.id, CAST(SUM(oi.quantity) AS INTEGER) as total_sold
      FROM "Product" p
      JOIN "ProductVariant" pv ON p.id = pv."productId"
      JOIN "OrderItem" oi ON pv.id = oi."variantId"
      JOIN "Order" o ON oi."orderId" = o.id
      WHERE o.status != 'CANCELLED'
      GROUP BY p.id
      ORDER BY total_sold DESC
      LIMIT 12;
    `;
    
    const topSoldIds = topSoldResult.map(r => r.id);
    let topSelling: any[] = [];

    // 2. Lấy thông tin chi tiết các sản phẩm bán chạy
    if (topSoldIds.length > 0) {
      topSelling = await prisma.product.findMany({
        where: { id: { in: topSoldIds } },
        include: {
          category: { select: { id: true, name: true, slug: true } }, 
          images: true,
          variants: true
        }
      });
      // Sắp xếp lại topSelling theo đúng thứ tự bán chạy nhất (desc)
      topSelling.sort((a, b) => topSoldIds.indexOf(a.id) - topSoldIds.indexOf(b.id));
    }

    // 3. Nếu chưa đủ 12 sản phẩm, lấy thêm các sản phẩm mới nhất để bù vào
    if (topSelling.length < 12) {
      const remainingCount = 12 - topSelling.length;
      const additionalProducts = await prisma.product.findMany({
        where: { id: { notIn: topSoldIds } },
        take: remainingCount,
        orderBy: { createdAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, slug: true } }, 
          images: true,
          variants: true
        }
      });
      topSelling = [...topSelling, ...additionalProducts];
    }

    const homeCategories = await prisma.category.findMany({
      where: { showOnHome: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        products: {
          take: 18,
          orderBy: { createdAt: 'desc' },
          include: {
            images: true,
            variants: true
          }
        }
      }
    });

    res.status(200).json({
      success: true,
      data: {
        topSelling,
        homeCategories
      }
    });
  } catch (error) {
    console.error('Lỗi lấy dữ liệu trang chủ:', error);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
};
