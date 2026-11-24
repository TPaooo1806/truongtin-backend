import { Request, Response } from 'express';
import prisma from '../config/prisma';
import * as XLSX from 'xlsx'; 
import ExcelJS from 'exceljs';
import { triggerRevalidate } from '../lib/revalidate';
import catalogCacheService from '../services/catalogCache.service';

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
    if (category && category !== 'ALL' && category !== 'all' && category !== '') {
      if (!isNaN(Number(category))) {
        whereCondition.categoryId = Number(category);
      } else {
        whereCondition.category = { slug: category };
      }
    }
    
    // Hỗ trợ lấy theo ID Danh mục trực tiếp (Dành cho chức năng Sản phẩm liên quan)
    const categoryId = req.query.categoryId as string | undefined;
    if (categoryId && categoryId !== 'ALL' && categoryId !== 'all' && categoryId !== '') {
      whereCondition.categoryId = Number(categoryId);
    }

    // [AUDIT-FIX] Bắt buộc: Loại trừ sản phẩm đang xem ra khỏi danh sách
    const excludeId = req.query.excludeId as string | undefined;
    if (excludeId) {
      whereCondition.id = { not: Number(excludeId) };
    }

    const brand = req.query.brand as string | undefined;
    if (brand && brand !== 'all' && brand !== 'Tất cả') {
      const brandCondition = {
        OR: [
          { brand: { equals: brand, mode: 'insensitive' as const } },
          { name: { contains: brand, mode: 'insensitive' as const } }
        ]
      };
      if (whereCondition.AND) {
        whereCondition.AND.push(brandCondition);
      } else {
        whereCondition.AND = [brandCondition];
      }
    }

    if (q && q.trim()) {
      const trimmedQ = q.trim();
      const searchWords = trimmedQ.split(/\s+/).filter(Boolean);
      
      const wordConditions = searchWords.map(word => ({
        OR: [
          { name: { contains: word, mode: 'insensitive' as const } },
          { brand: { contains: word, mode: 'insensitive' as const } }
        ]
      }));

      // Cho phép khớp hoặc toàn cụm q trong name/brand, hoặc tất cả các từ trong name/brand
      const searchCondition = {
        OR: [
          { name: { contains: trimmedQ, mode: 'insensitive' as const } },
          { brand: { contains: trimmedQ, mode: 'insensitive' as const } },
          { AND: wordConditions }
        ]
      };

      if (whereCondition.AND) {
        whereCondition.AND.push(searchCondition);
      } else {
        whereCondition.AND = [searchCondition];
      }
    }

    const [products, totalItems] = await Promise.all([
      prisma.product.findMany({
        where: whereCondition,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
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
    const { name, slug, brand, description, unit, categoryId, variants, images, attributes, isBulky } = req.body;

    const result = await prisma.product.create({
      data: {
        name,
        slug,
        brand: brand ? String(brand).trim() : null,
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

    // Đánh dấu cache RAM hết hạn (không gọi DB)
    catalogCacheService.invalidateCache();

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
    
    const { name, slug, brand, description, unit, categoryId, variants, images, attributes, isBulky } = req.body;

    const updatedProduct = await prisma.product.update({
      where: { id: productId },
      data: {
        name,
        slug,
        brand: brand !== undefined ? (brand ? String(brand).trim() : null) : undefined,
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
    catalogCacheService.invalidateCache();

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

    catalogCacheService.invalidateCache();

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
const STANDARD_BRANDS = [
  'CADIVI',
  'BÌNH MINH',
  'PANASONIC',
  'PHILIPS',
  'MPE',
  'SINO - VANLOCK',
  'DAPHACO',
  'APOLLO',
  'KHÁC'
];

/**
 * Phân tích chuỗi thông số kỹ thuật thành JSON Object
 * Hỗ trợ:
 * 1. Dạng phân tách: "Công suất: 20W | Chuẩn đui: E27 | Điện áp: 220V"
 * 2. Dạng phân tách chấm phẩy hoặc xuống dòng: "Công suất: 20W; Chuẩn đui: E27"
 * 3. Dạng JSON: '{"Công suất": "20W", "Chuẩn đui": "E27"}'
 */
function parseAttributes(raw: any): Record<string, string> | null {
  if (!raw) return null;
  const str = raw.toString().trim();
  if (!str) return null;

  // Dạng JSON
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed;
      }
    } catch {
      // Thử parse dạng phân tách nếu JSON lỗi cú pháp
    }
  }

  // Dạng chuỗi phân tách Key:Value|Key:Value
  const result: Record<string, string> = {};
  const pairs = str.split(/[|\n;]+/);

  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      if (key && value) {
        result[key] = value;
      }
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// =======================================================
// 1. API TẢI FORM MẪU IMPORT (HỖ TRỢ CẢ EXCEL .XLSX VÀ CSV)
// =======================================================
export const getImportTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({ 
      where: { isActive: true },
      select: { name: true },
      orderBy: { displayOrder: 'asc' }
    });

    const categoryNames = categories.length > 0 
      ? categories.map(c => c.name) 
      : ['Bóng đèn', 'Ống nước', 'Dây điện', 'Băng keo'];

    const format = ((req.query.format as string) || '').toLowerCase();

    // NẾU YÊU CẦU FILE CSV (Định dạng UTF-8 kèm BOM chống lỗi font tiếng Việt trên Excel)
    if (format === 'csv') {
      const headers = [
        'Tên sản phẩm *',
        'Danh mục *',
        'Thương hiệu',
        'Đơn vị tính',
        'Liên hệ báo giá',
        'Giá bán *',
        'Tồn kho *',
        'Thông số kỹ thuật',
        'Mô tả',
        'Link ảnh'
      ];

      const sampleRows = [
        [
          'Ống nhựa uPVC Bình Minh Phi 21 x 1.6mm',
          'Ống nước',
          'BÌNH MINH',
          'Cây',
          '0',
          '25000',
          '150',
          '"Đường kính ngoài:Ø21|Độ dày:1.6mm|Áp lực:PN10"',
          'Ống nhựa thoát nước uPVC chất lượng cao',
          'ong-nhua-bm-phi21.jpg'
        ],
        [
          'Cáp điện CADIVI CV 2.5 (1x2.5 mm2) 750V',
          'Dây điện',
          'CADIVI',
          'Cuộn',
          '1',
          '0',
          '80',
          '"Tiết diện:2.5mm2|Số lõi:1|Chất liệu:Đồng nguyên chất|Điện áp:450/750V"',
          'Dây cáp điện ruột đồng cách điện PVC (Liên hệ báo giá theo biến động kim loại)',
          'cadivi-cv-25.jpg'
        ],
        [
          'Bóng đèn LED Bulb MPE 9W Ánh Sáng Trắng',
          'Bóng đèn',
          'MPE',
          'Cái',
          '0',
          '35000',
          '200',
          '"Công suất:9W|Chuẩn đui:E27|Màu ánh sáng:Trắng 6500K|Điện áp:220V"',
          'Bóng LED tiết kiệm 80% điện năng tuổi thọ 30.000 giờ',
          'led-mpe-9w.jpg'
        ]
      ];

      const csvContent = [
        headers.join(','),
        ...sampleRows.map(row => row.join(','))
      ].join('\r\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="TruongTin_Template_Import.csv"');
      // Thêm ký tự UTF-8 BOM (\uFEFF) ở đầu file để Excel trên Windows hiển thị đúng tiếng Việt có dấu
      res.send('\uFEFF' + csvContent);
      return;
    }

    // NẾU YÊU CẦU FILE EXCEL .XLSX (Mặc định)
    const workbook = new ExcelJS.Workbook();

    // Sheet ẩn Data chứa danh mục và thương hiệu chuẩn hóa
    const dataSheet = workbook.addWorksheet("Data", { state: 'hidden' });
    categoryNames.forEach((name, idx) => {
      dataSheet.getCell(`A${idx + 1}`).value = name;
    });
    STANDARD_BRANDS.forEach((brand, idx) => {
      dataSheet.getCell(`B${idx + 1}`).value = brand;
    });

    const worksheet = workbook.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 1 }] // Khóa hàng tiêu đề
    });

    worksheet.columns = [
      { header: 'Tên sản phẩm *', key: 'name', width: 38 },
      { header: 'Danh mục *', key: 'category', width: 22 },
      { header: 'Thương hiệu', key: 'brand', width: 20 },
      { header: 'Đơn vị tính', key: 'unit', width: 14 },
      { header: 'Liên hệ báo giá', key: 'is_contact_price', width: 18 },
      { header: 'Giá bán *', key: 'price', width: 16 },
      { header: 'Tồn kho *', key: 'stock', width: 14 },
      { header: 'Thông số kỹ thuật', key: 'attributes', width: 45 },
      { header: 'Mô tả', key: 'desc', width: 40 },
      { header: 'Link ảnh', key: 'images', width: 25 },
    ];

    // Định dạng hàng tiêu đề
    const headerRow = worksheet.getRow(1);
    headerRow.height = 32;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, size: 12, color: { argb: 'FF1A3A5C' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEBF5FF' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        left: { style: 'thin', color: { argb: 'FFCCCCCC' } },
        bottom: { style: 'medium', color: { argb: 'FF0078D4' } },
        right: { style: 'thin', color: { argb: 'FFCCCCCC' } }
      };
    });

    const formatRow = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.font = { size: 11 };
        cell.alignment = { vertical: 'middle' };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
          right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
        };
      });
    };

    // Dòng mẫu 1: Sản phẩm có giá bán thông thường
    formatRow(worksheet.addRow({
      name: 'Ống nhựa uPVC Bình Minh Phi 21 x 1.6mm',
      category: 'Ống nước',
      brand: 'BÌNH MINH',
      unit: 'Cây',
      is_contact_price: 0,
      price: 25000,
      stock: 150,
      attributes: 'Đường kính ngoài:Ø21|Độ dày:1.6mm|Áp lực:PN10',
      desc: 'Ống nhựa thoát nước uPVC chất lượng cao chính hãng',
      images: 'ong-nhua-bm-phi21.jpg'
    }));

    // Dòng mẫu 2: Sản phẩm Liên hệ báo giá (dây cáp điện lớn)
    formatRow(worksheet.addRow({
      name: 'Cáp điện CADIVI CV 2.5 (1x2.5 mm2) 750V',
      category: 'Dây điện',
      brand: 'CADIVI',
      unit: 'Cuộn',
      is_contact_price: 1,
      price: 0,
      stock: 80,
      attributes: 'Tiết diện:2.5mm2|Số lõi:1|Chất liệu:Đồng nguyên chất|Điện áp:450/750V',
      desc: 'Dây cáp điện ruột đồng cách điện PVC (Liên hệ báo giá theo biến động giá đồng)',
      images: 'cadivi-cv-25.jpg'
    }));

    // Dòng mẫu 3: Thiết bị chiếu sáng
    formatRow(worksheet.addRow({
      name: 'Bóng đèn LED Bulb MPE 9W Ánh Sáng Trắng',
      category: 'Bóng đèn',
      brand: 'MPE',
      unit: 'Cái',
      is_contact_price: 0,
      price: 35000,
      stock: 200,
      attributes: 'Công suất:9W|Chuẩn đui:E27|Màu ánh sáng:Trắng 6500K|Điện áp:220V',
      desc: 'Bóng LED tiết kiệm 80% điện năng tuổi thọ 30.000 giờ',
      images: 'led-mpe-9w.jpg'
    }));

    // Gán Validation cho 2000 dòng dữ liệu
    for (let i = 2; i <= 2000; i++) {
      // Cột B: Dropdown Danh mục
      worksheet.getCell(`B${i}`).dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`Data!$A$1:$A$${categoryNames.length}`],
        showErrorMessage: true,
        errorTitle: 'Sai danh mục',
        error: 'Vui lòng chọn danh mục có sẵn trong hệ thống!'
      };

      // Cột C: Dropdown Thương hiệu
      worksheet.getCell(`C${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`Data!$B$1:$B$${STANDARD_BRANDS.length}`],
        showErrorMessage: true,
        errorTitle: 'Thương hiệu chưa chuẩn',
        error: 'Vui lòng chọn thương hiệu trong danh sách hoặc nhập hãng khác!'
      };

      // Cột E: Liên hệ báo giá (0 = Có giá, 1 = Liên hệ báo giá Zalo)
      worksheet.getCell(`E${i}`).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"0, 1"'],
        showInputMessage: true,
        promptTitle: 'Liên hệ báo giá',
        prompt: 'Điền 1 nếu là hàng liên hệ báo giá Zalo (Giá sẽ tự động là 0), điền 0 nếu có giá cụ thể.'
      };

      // Cột F (Giá bán) và Cột G (Tồn kho): Số nguyên >= 0
      worksheet.getCell(`F${i}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] };
      worksheet.getCell(`G${i}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TruongTin_Template_Import.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Lỗi tạo form mẫu import:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi sinh file mẫu" });
  }
};

// =======================================================
// 2. API XỬ LÝ IMPORT (HỖ TRỢ EXCEL & CSV + BÁO LỖI THÔNG MINH)
// =======================================================
export const importProductsFromExcel = async (req: Request | any, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Vui lòng chọn file Excel hoặc CSV để import" });
      return;
    }

    // Đọc buffer bằng XLSX (Hỗ trợ cả .xlsx, .xls và .csv)
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    
    // Tự động tìm Sheet "Products" nếu có, hoặc lấy Sheet đầu tiên (đối với file CSV hoặc tên sheet khác)
    const sheetName = workbook.SheetNames.includes("Products") ? "Products" : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
      res.status(400).json({ success: false, message: "File không hợp lệ hoặc không có dữ liệu!" });
      return;
    }

    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    // Lấy imagesMap từ Frontend gửi lên (nếu có nạp ảnh qua Cloudinary)
    const imagesMapStr = req.body.imagesMap;
    let imagesMap: Record<string, string> = {};
    try {
      if (imagesMapStr) {
        imagesMap = JSON.parse(imagesMapStr);
      }
    } catch {
      console.error("Lỗi parse imagesMap JSON");
    }

    // Chuẩn hóa tên file ảnh độc lập định dạng
    const normalizeFileName = (name: string) => {
      return name
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
    };

    const normalizedImagesMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(imagesMap)) {
      normalizedImagesMap[normalizeFileName(key)] = value;
    }

    if (rows.length === 0) {
      res.status(400).json({ success: false, message: "File dữ liệu trống!" });
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

    const cleanStr = (str: any) => str ? str.toString().replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';
    const generateSlug = (str: string) => cleanStr(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    const capitalizeFirst = (str: string) => {
      if (!str) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    const parsePrice = (raw: any): number => {
      if (raw === undefined || raw === null || raw === '') return 0;
      if (typeof raw === 'number') return raw;
      return Number(raw.toString().replace(/[,.]/g, '')) || 0;
    };

    let successCount = 0;
    const errors: { row: number; reason: string }[] = [];
    const warnings: { row: number; name: string; reason: string }[] = [];
    const validPayloads: { rowNumber: number; data: any }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // Hàng 1 là Header, dữ liệu tính từ dòng 2

      // 1. TÊN SẢN PHẨM (BẮT BUỘC)
      const rawName = cleanStr(row["Tên sản phẩm *"] || row["Tên sản phẩm"] || row["name"]);
      if (!rawName) {
        errors.push({ row: rowNumber, reason: "Thiếu tên sản phẩm (Cột Tên sản phẩm để trống)" });
        continue;
      }
      const name = capitalizeFirst(rawName);

      // 2. DANH MỤC (BẮT BUỘC)
      const rawCat = cleanStr(row["Danh mục *"] || row["Danh mục"] || row["category"]);
      if (!rawCat) {
        errors.push({ row: rowNumber, reason: "Thiếu danh mục sản phẩm (Cột Danh mục để trống)" });
        continue;
      }
      const catId = categoryMap.get(rawCat.toLowerCase());
      if (!catId) {
        errors.push({ row: rowNumber, reason: `Danh mục '${rawCat}' không tồn tại trong hệ thống. Vui lòng tạo danh mục trước khi import!` });
        continue;
      }

      // 3. THƯƠNG HIỆU (BRAND) - CHUẨN HÓA & AUTO-DETECT
      const rawBrand = cleanStr(row["Thương hiệu"] || row["Brand"] || row["brand"] || row["Hãng"]);
      let brand: string | null = null;

      if (rawBrand) {
        const lowerB = rawBrand.toLowerCase();
        if (lowerB.includes("cadivi")) brand = "CADIVI";
        else if (lowerB.includes("binh minh") || lowerB.includes("bình minh")) brand = "BÌNH MINH";
        else if (lowerB.includes("panasonic")) brand = "PANASONIC";
        else if (lowerB.includes("philips")) brand = "PHILIPS";
        else if (lowerB.includes("mpe")) brand = "MPE";
        else if (lowerB.includes("sino") || lowerB.includes("vanlock")) brand = "SINO - VANLOCK";
        else if (lowerB.includes("daphaco")) brand = "DAPHACO";
        else if (lowerB.includes("apollo")) brand = "APOLLO";
        else brand = rawBrand.toUpperCase();
      } else {
        // Tự động suy luận thương hiệu từ Tên sản phẩm nếu file để trống
        const lowerName = name.toLowerCase();
        if (lowerName.includes("cadivi")) brand = "CADIVI";
        else if (lowerName.includes("bình minh") || lowerName.includes("binh minh")) brand = "BÌNH MINH";
        else if (lowerName.includes("panasonic")) brand = "PANASONIC";
        else if (lowerName.includes("philips")) brand = "PHILIPS";
        else if (lowerName.includes("mpe")) brand = "MPE";
        else if (lowerName.includes("sino") || lowerName.includes("vanlock")) brand = "SINO - VANLOCK";
        else if (lowerName.includes("daphaco")) brand = "DAPHACO";
        else if (lowerName.includes("apollo")) brand = "APOLLO";
        else {
          warnings.push({ row: rowNumber, name, reason: "Để trống Thương hiệu (Brand), sản phẩm sẽ không hiển thị ở bộ lọc Brand Chips." });
        }
      }

      // 4. LIÊN HỆ BÁO GIÁ & GIÁ BÁN
      const rawContact = row["Liên hệ báo giá"] ?? row["is_contact_price"] ?? row["isContactPrice"] ?? row["Báo giá"];
      const rawPrice = row["Giá bán *"] ?? row["Giá bán"] ?? row["price"] ?? row["giá"];
      let price = parsePrice(rawPrice);

      const isContactFlag = rawContact !== undefined && (
        rawContact === 1 || rawContact === '1' || rawContact === true || rawContact === 'true' || 
        rawContact.toString().toLowerCase() === 'có' || rawContact.toString().toLowerCase() === 'yes'
      );

      // Nếu tick chọn Liên hệ báo giá HOẶC cố tình điền giá = 0 -> Tự động chuyển sang chế độ Báo giá Zalo
      if (isContactFlag || price === 0) {
        price = 0;
      } else if (price < 0) {
        errors.push({ row: rowNumber, reason: `Giá bán không hợp lệ (${rawPrice}), giá không được là số âm.` });
        continue;
      }

      // 5. TỒN KHO
      const rawStock = row["Tồn kho *"] ?? row["Tồn kho"] ?? row["stock"] ?? 0;
      const stock = Number(rawStock);
      if (isNaN(stock) || stock < 0) {
        errors.push({ row: rowNumber, reason: `Tồn kho không hợp lệ (${rawStock}), phải là số nguyên >= 0.` });
        continue;
      }

      // 6. THÔNG SỐ KỸ THUẬT (ATTRIBUTES)
      const rawAttr = row["Thông số kỹ thuật"] ?? row["attributes"] ?? row["thông số"] ?? row["thong_so"];
      const attributesObj = parseAttributes(rawAttr);

      // 7. ĐƠN VỊ TÍNH, MÔ TẢ & ẢNH
      const unit = cleanStr(row["Đơn vị tính"] || row["unit"]) || "Cái";
      const description = cleanStr(row["Mô tả"] || row["desc"] || row["description"]);
      const imagesStr = cleanStr(row["Link ảnh"] || row["images"] || row["image"]);

      // 8. KIỂM TRA SLUG TRÙNG
      const slug = generateSlug(name);
      if (existingSlugs.has(slug)) {
        errors.push({ row: rowNumber, reason: `Sản phẩm '${name}' đã tồn tại trong hệ thống (Trùng tên).` });
        continue;
      }
      existingSlugs.add(slug);

      // 9. XỬ LÝ ẢNH
      const imagesArray: { url: string }[] = [];
      if (imagesStr) {
        const parts = imagesStr.split(/[;,]+/);
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

      // 10. TẠO BIẾN THỂ MẶC ĐỊNH
      const sku = `SP-${Date.now().toString().slice(-6)}-${rowNumber}-${Math.floor(Math.random() * 1000)}`;
      const variantsCreate = [
        { name: "Mặc định", sku, price, stock }
      ];

      validPayloads.push({
        rowNumber,
        data: {
          name,
          slug,
          brand,
          attributes: attributesObj || undefined,
          description,
          unit,
          categoryId: catId,
          variants: { create: variantsCreate },
          images: { create: imagesArray },
        }
      });
    }

    // BATCH INSERT CONCURRENT (Chạy song song 50 lệnh/lần)
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
          let errDetail = "Lỗi lưu cơ sở dữ liệu";
          if (result.error instanceof Error) {
            errDetail = result.error.message.split('\n').pop() || result.error.message;
          }
          errors.push({ row: result.rowNumber, reason: `Lỗi lưu DB: ${errDetail}` });
        }
      });
    }

    // Kích hoạt revalidate trang chủ & danh mục
    triggerRevalidate('/');
    catalogCacheService.invalidateCache();

    res.status(200).json({
      success: true,
      message: `Import thành công ${successCount} sản phẩm!`,
      data: { successCount, failedCount: errors.length, errors, warnings }
    });

  } catch (error) {
    console.error("Lỗi Import Excel/CSV:", error);
    res.status(500).json({ success: false, message: "Lỗi hệ thống khi xử lý file import" });
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
      where: { showOnHome: true, isActive: true },
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
