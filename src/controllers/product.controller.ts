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
    
    // Há»— trá»£ láº¥y theo ID Danh má»¥c trá»±c tiáº¿p (DÃ nh cho chá»©c nÄƒng Sáº£n pháº©m liÃªn quan)
    const categoryId = req.query.categoryId as string | undefined;
    if (categoryId) {
      whereCondition.categoryId = Number(categoryId);
    }

    // [AUDIT-FIX] Báº¯t buá»™c: Loáº¡i trá»« sáº£n pháº©m Ä‘ang xem ra khá»i danh sÃ¡ch
    const excludeId = req.query.excludeId as string | undefined;
    if (excludeId) {
      whereCondition.id = { not: Number(excludeId) };
    }

   if (q) {
  // BÄƒm tá»« khÃ³a thÃ nh máº£ng cÃ¡c tá»« (vd: "á»‘ng pvc" -> ["á»‘ng", "pvc"])
  const searchWords = q.trim().split(/\s+/);
  
  // YÃªu cáº§u Prisma tÃ¬m sáº£n pháº©m cÃ³ chá»©a Táº¤T Cáº¢ cÃ¡c tá»« nÃ y
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
    console.error("Lá»—i láº¥y danh sÃ¡ch sáº£n pháº©m:", error);
    res.status(500).json({ success: false, message: "Lá»—i server" });
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
        unit: unit || "CÃ¡i",
        categoryId: parseInt(categoryId),
        variants: {
          create: variants.map((v: VariantInput, index: number) => {
            const variantName = v.attributeValue || v.name || "Máº·c Ä‘á»‹nh"; 
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
    console.error("ðŸš€ Lá»—i táº¡o sáº£n pháº©m:", error.message || error); 
    res.status(500).json({ success: false, message: "Lá»—i táº¡o sáº£n pháº©m" });
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
        unit: unit || "CÃ¡i",
        categoryId: parseInt(categoryId),
        variants: {
          deleteMany: {}, 
          create: variants.map((v: VariantInput, index: number) => {
            const variantName = v.attributeValue || v.name || "Máº·c Ä‘á»‹nh";
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

    // Ã‰p Next.js xÃ³a cache trang chi tiáº¿t sáº£n pháº©m nÃ y
    await triggerRevalidate(`/product/${slug}`);

    res.status(200).json({ success: true, message: "Cáº­p nháº­t thÃ nh cÃ´ng", data: updatedProduct });
  } catch (error: any) {
    console.error("ðŸš€ Lá»—i cáº­p nháº­t sáº£n pháº©m:", error.message || error);
    res.status(500).json({ success: false, message: "Lá»—i cáº­p nháº­t sáº£n pháº©m" });
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

    res.status(200).json({ success: true, message: "ÄÃ£ xÃ³a" });
  } catch (error: any) {
    console.error("ðŸš€ Lá»—i xÃ³a sáº£n pháº©m:", error.message || error);
    res.status(500).json({ success: false, message: "Lá»—i khi xÃ³a" });
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
      res.status(404).json({ success: false, message: "KhÃ´ng tÃ¬m tháº¥y" });
      return;
    }
    
    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error("Lá»—i láº¥y chi tiáº¿t sáº£n pháº©m:", error);
    res.status(500).json({ success: false, message: "Lá»—i server" });
  }
};

// =======================================================
// 1. API Táº¢I FORM MáºªU EXCEL (Báº¢N PRO CÃ“ Äá»ŠNH Dáº NG & DROPDOWN)
// =======================================================
export const getImportTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const categories = await prisma.category.findMany({ select: { name: true } });
    const workbook = new ExcelJS.Workbook();

    // Táº O SHEET áº¨N CHá»¨A DATA DROPDOWN (Chá»‘ng lá»—i 255 kÃ½ tá»± cá»§a Excel)
    const dataSheet = workbook.addWorksheet("Data", { state: 'hidden' });
    categories.forEach((c, index) => {
      dataSheet.getCell(`A${index + 1}`).value = c.name;
    });

    const worksheet = workbook.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 1 }] // ÄÃ³ng bÄƒng Header
    });

    worksheet.columns = [
      { header: 'TÃªn sáº£n pháº©m *', key: 'name', width: 35 },
      { header: 'Danh má»¥c *', key: 'category', width: 25 },
      { header: 'ÄÆ¡n vá»‹ tÃ­nh', key: 'unit', width: 15 },
      { header: 'GiÃ¡ bÃ¡n *', key: 'price', width: 15 },
      { header: 'Tá»“n kho *', key: 'stock', width: 15 },
      { header: 'MÃ´ táº£', key: 'desc', width: 50 },
      { header: 'Link áº£nh', key: 'images', width: 30 },
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

    const sampleCat = categories[0]?.name || 'BÃ³ng Ä‘Ã¨n';

    // DATA MáºªU - SP Ä‘Æ¡n giáº£n
    const formatRow = (row: ExcelJS.Row) => {
      row.eachCell((cell) => {
        cell.font = { size: 12 };
        cell.alignment = { vertical: 'middle' };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
      });
    };
    formatRow(worksheet.addRow({
      name: 'á»ng nhá»±a PVC BÃ¬nh Minh Phi 21',
      category: sampleCat,
      unit: 'CÃ¢y', price: 25000, stock: 100,
      desc: 'Sáº£n pháº©m chÃ­nh hÃ£ng', images: ''
    }));

    formatRow(worksheet.addRow({
      name: 'BÃ³ng Ä‘Ã¨n LED MPE 3W', 
      category: sampleCat,
      unit: 'CÃ¡i', price: 15000, stock: 50,
      desc: 'BÃ³ng LED tiáº¿t kiá»‡m Ä‘iá»‡n', images: 'bongden-mpe.jpg'
    }));

    // GÃN DROPDOWN (Trá» vá» Sheet áº©n) - Cá»™t B váº«n lÃ  Danh má»¥c
    for (let i = 2; i <= 2000; i++) {
      worksheet.getCell(`B${i}`).dataValidation = {
        type: 'list', allowBlank: false,
        formulae: [`Data!$A$1:$A$${categories.length || 1}`],
        showErrorMessage: true, errorTitle: 'Sai danh má»¥c', error: 'Vui lÃ²ng chá»n danh má»¥c cÃ³ sáºµn!'
      };
      // Validate Sá»‘ - Cá»™t D (GiÃ¡ bÃ¡n) vÃ  E (Tá»“n kho)
      worksheet.getCell(`D${i}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] };
      worksheet.getCell(`E${i}`).dataValidation = { type: 'whole', operator: 'greaterThanOrEqual', formulae: [0] };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="TruongTin_Template_Import.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Lá»—i táº¡o form máº«u:", error);
    res.status(500).json({ success: false, message: "Lá»—i server" });
  }
};

// =======================================================
// 2. API Xá»¬ LÃ IMPORT (BATCHING CONCURRENT + NORMALIZE + LIMIT)
// =======================================================
export const importProductsFromExcel = async (req: Request | any, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, message: "Vui lÃ²ng chá»n file Excel" });
      return;
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets["Products"]; 
    
    // Báº¯t lá»—i rá»§i ro náº¿u Admin tá»± Ã½ Ä‘á»•i tÃªn Sheet dÆ°á»›i Excel
    if (!sheet) {
      res.status(400).json({ success: false, message: "File Excel khÃ´ng há»£p lá»‡. Vui lÃ²ng khÃ´ng Ä‘á»•i tÃªn Sheet 'Products'!" });
      return;
    }
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    // Láº¥y imagesMap tá»« Frontend gá»­i lÃªn (náº¿u cÃ³)
    const imagesMapStr = req.body.imagesMap;
    let imagesMap: Record<string, string> = {};
    try {
      if (imagesMapStr) {
        imagesMap = JSON.parse(imagesMapStr);
      }
    } catch(e) {
      console.error("Invalid imagesMap JSON");
    }

    // HÃ m chuáº©n hÃ³a tÃªn file siÃªu cáº¥p (XÃ³a bá» má»i khoáº£ng tráº¯ng, dáº¥u gáº¡ch ngang, kÃ½ tá»± Ä‘áº·c biá»‡t)
    const normalizeFileName = (name: string) => {
      return name
        .toLowerCase()
        .replace(/\.[a-z0-9]+$/, "") // XÃ³a bá» Ä‘uÃ´i file Ä‘á»ƒ so khá»›p Ä‘á»™c láº­p Ä‘á»‹nh dáº¡ng
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Bá» dáº¥u tiáº¿ng Viá»‡t
        .replace(/[^a-z0-9]/g, "") // XÃ³a má»i khoáº£ng tráº¯ng, dáº¥u gáº¡ch ngang, underscore...
        .trim();
    };

    // Chuáº©n hÃ³a key cá»§a imagesMap
    const normalizedImagesMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(imagesMap)) {
      normalizedImagesMap[normalizeFileName(key)] = value;
    }

    // IMPROVEMENT 3: GIá»šI Háº N FILE SIZE & DÃ’NG
    if (rows.length === 0) {
      res.status(400).json({ success: false, message: "File Excel trá»‘ng" });
      return;
    }
    if (rows.length > 10000) {
      res.status(400).json({ success: false, message: "File quÃ¡ lá»›n! Giá»›i háº¡n tá»‘i Ä‘a 10.000 dÃ²ng/láº§n." });
      return;
    }

    const categories = await prisma.category.findMany();
    const categoryMap = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]));
    
    const existingProducts = await prisma.product.findMany({ select: { slug: true } });
    const existingSlugs = new Set(existingProducts.map(p => p.slug));

    // IMPROVEMENT 2: LÃ€M Sáº CH VÃ€ CHUáº¨N HÃ“A INPUT
    const cleanStr = (str: any) => str ? str.toString().replace(/[\u200B-\u200D\uFEFF]/g, '').trim() : '';
    const generateSlug = (str: string) => cleanStr(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    // HÃ m tá»± Ä‘á»™ng viáº¿t hoa chá»¯ cÃ¡i Ä‘áº§u má»—i tá»« (Title Case)
    const capitalizeFirst = (str: string) => {
      if (!str) return str;
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    // HÃ m parse giÃ¡ tiá»n thÃ´ng minh (cháº¥p nháº­n dáº¥u pháº©y, dáº¥u cháº¥m, hoáº·c Ä‘á»ƒ trá»‘ng = 0)
    const parsePrice = (raw: any): number => {
      if (raw === undefined || raw === null || raw === '') return 0;
      if (typeof raw === 'number') return raw;
      return Number(raw.toString().replace(/[,.]/g, '')) || 0;
    };

    let successCount = 0;
    let errors: any[] = [];
    let warnings: any[] = [];

    // ===================================================================
    // BÆ¯á»šC 1: XÃ‚Y Dá»°NG PAYLOAD Tá»ª Tá»ªNG DÃ’NG EXCEL
    // ===================================================================
    const validPayloads: { rowNumber: number; data: any }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = i + 2; // DÃ²ng 1 lÃ  header, dá»¯ liá»‡u báº¯t Ä‘áº§u tá»« dÃ²ng 2

      const rawName = cleanStr(row["TÃªn sáº£n pháº©m *"]);
      if (!rawName) { errors.push({ row: rowNumber, reason: "Thiáº¿u tÃªn sáº£n pháº©m" }); continue; }

      // Tá»± Ä‘á»™ng viáº¿t hoa chá»¯ cÃ¡i Ä‘áº§u
      const name = capitalizeFirst(rawName);

      const catName = cleanStr(row["Danh má»¥c *"]).toLowerCase();
      const unit = cleanStr(row["ÄÆ¡n vá»‹ tÃ­nh"]) || "CÃ¡i";
      const price = parsePrice(row["GiÃ¡ bÃ¡n *"]);
      const stock = Number(row["Tá»“n kho *"]) || 0;
      const description = cleanStr(row["MÃ´ táº£"]);
      const imagesStr = cleanStr(row["Link áº£nh"]);

      if (price < 0) { errors.push({ row: rowNumber, reason: "GiÃ¡ bÃ¡n khÃ´ng Ä‘Æ°á»£c Ã¢m" }); continue; }

      const categoryId = categoryMap.get(catName);
      if (!categoryId) { errors.push({ row: rowNumber, reason: `Danh má»¥c '${row["Danh má»¥c *"]}' khÃ´ng tá»“n táº¡i` }); continue; }

      const slug = generateSlug(name);

      // Kiá»ƒm tra trÃ¹ng tÃªn vá»›i Database (ká»ƒ cáº£ nhá»¯ng slug Ä‘Ã£ thÃªm trong Ä‘á»£t nÃ y)
      if (existingSlugs.has(slug)) {
        errors.push({ row: rowNumber, reason: `Sáº£n pháº©m '${name}' Ä‘Ã£ tá»“n táº¡i (TrÃ¹ng tÃªn)` });
        continue;
      }
      existingSlugs.add(slug);

      // Xá»­ lÃ½ chuá»—i Link áº£nh
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
              warnings.push({ row: rowNumber, name, reason: `KhÃ´ng tÃ¬m tháº¥y file áº£nh tÆ°Æ¡ng á»©ng: ${urlOrName}` });
            }
          }
        }
      }

      // Táº¡o máº£ng Variants (Má»—i sáº£n pháº©m cÃ³ 1 biáº¿n thá»ƒ máº·c Ä‘á»‹nh)
      const sku = `SP-${Date.now().toString().slice(-6)}-${rowNumber}-${Math.floor(Math.random() * 1000)}`;
      const variantsCreate = [
        { name: "Máº·c Ä‘á»‹nh", sku, price, stock }
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
    // BÆ¯á»šC 3: BATCH INSERT CONCURRENT (Cháº¡y song song 50 lá»‡nh)
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
          console.error(`Lá»—i DB dÃ²ng ${result.rowNumber}:`, result.error);
          
          let errDetail = "Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh";
          if (result.error instanceof Error) {
            errDetail = result.error.message.split('\n').pop() || result.error.message;
          } else if (typeof result.error === 'string') {
            errDetail = result.error;
          }
          
          errors.push({ row: result.rowNumber, reason: `Lá»—i lÆ°u DB: ${errDetail}` });
        }
      });
    }

    res.status(200).json({
      success: true,
      data: { successCount, failedCount: errors.length, errors, warnings }
    });

  } catch (error) {
    console.error("Lá»—i Import Excel:", error);
    res.status(500).json({ success: false, message: "Lá»—i há»‡ thá»‘ng khi xá»­ lÃ½ file" });
  }
};

export const getHomeData = async (req: Request, res: Response): Promise<void> => {
  try {
    const topSelling = await prisma.product.findMany({
      take: 12,
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { id: true, name: true, slug: true } }, 
        images: true,
        variants: true
      }
    });

    const homeCategories = await prisma.category.findMany({
      where: { showOnHome: true },
      orderBy: { displayOrder: 'asc' },
      include: {
        products: {
          take: 6,
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
    console.error('L×i l¥y dï liÇu trang chç:', error);
    res.status(500).json({ success: false, message: 'L×i server' });
  }
};



