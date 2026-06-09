import { Request, Response } from 'express';

// ==========================================
// BẢNG PHÍ VẬN CHUYỂN THEO VÙNG (Zone-based Shipping)
// ==========================================

// Vùng 1: 15,000đ — Trung tâm TP.HCM
const ZONE1_DISTRICTS = [
  'bình thạnh', 'binh thanh',
  'phú nhuận', 'phu nhuan',
  'quận 1', 'quan 1', 'q1', 'q. 1',
  'quận 2', 'quan 2', 'q2', 'q. 2',
  'quận 3', 'quan 3', 'q3', 'q. 3',
];
const ZONE1_FEE = 15000;

// Vùng 2: 25,000đ — TP.HCM mở rộng
const ZONE2_DISTRICTS = [
  'quận 4', 'quan 4', 'q4', 'q. 4',
  'quận 5', 'quan 5', 'q5', 'q. 5',
  'quận 6', 'quan 6', 'q6', 'q. 6',
  'quận 7', 'quan 7', 'q7', 'q. 7',
  'quận 8', 'quan 8', 'q8', 'q. 8',
  'quận 10', 'quan 10', 'q10', 'q. 10',
  'quận 11', 'quan 11', 'q11', 'q. 11',
  'tân bình', 'tan binh',
  'gò vấp', 'go vap',
  'thủ đức', 'thu duc',
];
const ZONE2_FEE = 25000;

// Vùng 3: 35,000đ — TP.HCM ngoại thành
const ZONE3_DISTRICTS = [
  'quận 9', 'quan 9', 'q9', 'q. 9',
  'quận 12', 'quan 12', 'q12', 'q. 12',
  'bình tân', 'binh tan',
  'tân phú', 'tan phu',
  'bình chánh', 'binh chanh',
  'hóc môn', 'hoc mon',
  'củ chi', 'cu chi',
  'nhà bè', 'nha be',
  'cần giờ', 'can gio',
];
const ZONE3_FEE = 35000;

// Vùng 4: 30,000đ — Tỉnh lân cận
const ZONE4_PROVINCES = [
  'bình dương', 'binh duong',
  'đồng nai', 'dong nai',
  'long an',
];
const ZONE4_FEE = 30000;

// Vùng 5: 40,000đ — Tất cả tỉnh còn lại
const ZONE5_FEE = 40000;

// Normalize chuỗi: lowercase + trim
const normalize = (str: string) => str.toLowerCase().trim();

// Kiểm tra xem text có chứa bất kỳ từ khóa nào không
const matchesAny = (text: string, keywords: string[]) => {
  const norm = normalize(text);
  return keywords.some(kw => norm.includes(normalize(kw)));
};

// ==========================================
// CONTROLLER: TÍNH PHÍ VẬN CHUYỂN
// ==========================================
export const calculateShippingFee = async (req: Request, res: Response): Promise<void> => {
  try {
    const { items, province, district } = req.body;

    // Validation
    if (!province) {
      res.status(400).json({ success: false, message: 'Thiếu tỉnh/thành phố.' });
      return;
    }

    // LOGIC 1: Chặn hàng cồng kềnh
    const hasBulkyItem = Array.isArray(items) && items.some((item: any) => item.isBulky === true);
    if (hasBulkyItem) {
      res.status(200).json({
        success: true,
        fee: null,
        message: 'Hàng cồng kềnh. Cửa hàng sẽ liên hệ báo giá phí ship.'
      });
      return;
    }

    // LOGIC 2: Tính phí Zone-based
    const provinceNorm = normalize(province);
    const districtNorm = district ? normalize(district) : '';

    // Kiểm tra TP.HCM
    const isHCMC = provinceNorm.includes('hồ chí minh') || 
                   provinceNorm.includes('ho chi minh') ||
                   provinceNorm.includes('hcm') ||
                   provinceNorm.includes('tp.hcm') ||
                   provinceNorm.includes('tp hcm');

    let fee = ZONE5_FEE; // Mặc định Vùng 5

    if (isHCMC && districtNorm) {
      if (matchesAny(districtNorm, ZONE1_DISTRICTS)) {
        fee = ZONE1_FEE;
      } else if (matchesAny(districtNorm, ZONE2_DISTRICTS)) {
        fee = ZONE2_FEE;
      } else if (matchesAny(districtNorm, ZONE3_DISTRICTS)) {
        fee = ZONE3_FEE;
      } else {
        fee = ZONE3_FEE; // TP.HCM không khớp quận cụ thể → áp Vùng 3
      }
    } else if (isHCMC && !districtNorm) {
      fee = ZONE3_FEE; // TP.HCM nhưng chưa chọn quận
    } else if (matchesAny(province, ZONE4_PROVINCES)) {
      fee = ZONE4_FEE;
    }

    res.status(200).json({
      success: true,
      fee,
      message: 'Giao hàng tiêu chuẩn'
    });

  } catch (error: any) {
    console.error('[Shipping] Lỗi tính phí ship:', error.message);
    res.status(500).json({ success: false, message: 'Lỗi tính phí vận chuyển.' });
  }
};
