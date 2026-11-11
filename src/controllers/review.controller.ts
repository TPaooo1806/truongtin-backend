import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { checkProfanity } from '../lib/moderation';

interface AuthRequest extends Request {
  user?: {
    id: number;
    userId?: number;
    phone?: string;
    role?: string;
    [key: string]: unknown;
  };
}

/**
 * Hàm che số điện thoại để bảo vệ quyền riêng tư người dùng ngoài Frontend
 * Ví dụ: 0903989096 -> 090****096
 */
function maskPhoneNumber(phone?: string | null): string | null {
  if (!phone) return null;
  const clean = phone.trim();
  if (clean.length < 7) return clean;
  return clean.slice(0, 3) + '****' + clean.slice(-3);
}

// ============================================================================
// 1. PUBLIC API: LẤY DANH SÁCH ĐÁNH GIÁ SẢN PHẨM (CHỈ LẤY CÁC CMT ĐÃ DUYỆT)
// ============================================================================
export const getProductReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const reviews = await prisma.review.findMany({
      where: { 
        productId: Number(id),
        status: 'APPROVED' // Chỉ hiển thị các cmt đã duyệt hoặc tự động approved
      },
      select: {
        id: true,
        userName: true,
        userPhone: true,
        rating: true,
        comment: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    // Che số điện thoại của khách hàng trước khi trả về Frontend công khai
    const sanitizedReviews = reviews.map(r => ({
      ...r,
      userPhone: maskPhoneNumber(r.userPhone)
    }));

    res.status(200).json({ success: true, data: sanitizedReviews });
  } catch (error) {
    console.error("Lỗi lấy danh sách đánh giá:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi nạp đánh giá" });
  }
};

// ============================================================================
// 2. PUBLIC API: GỬI ĐÁNH GIÁ MỚI (TỰ ĐỘNG HIỂN THỊ, TỰ ĐỘNG ẨN TỪ CẤM)
// ============================================================================
export const createReview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productId, rating, comment, userName: bodyUserName, userPhone: bodyUserPhone } = req.body;

    const userId = req.user?.id || req.user?.userId;

    if (!productId || !rating) {
      res.status(400).json({ success: false, message: "Thiếu thông tin đánh giá" });
      return;
    }

    let customerName = bodyUserName || "Khách hàng";
    let customerPhone = bodyUserPhone || null;

    // Nếu người dùng đã đăng nhập, ưu tiên lấy tên & SĐT thật từ cơ sở dữ liệu
    if (userId) {
      const dbUser = await prisma.user.findUnique({
        where: { id: Number(userId) },
        select: { name: true, phone: true }
      });
      if (dbUser) {
        if (dbUser.name) customerName = dbUser.name;
        if (dbUser.phone) customerPhone = dbUser.phone;
      }
    }

    const reviewText = (comment || "").trim();

    // AUTOMATION: KIỂM TRA TỪ CẤM / NGÔN TỪ XÚC PHẠM LĂNG MẠ
    const { isProfane, matchedWords } = checkProfanity(reviewText);

    // Nếu vi phạm từ cấm: Tự động đưa về trạng thái REJECTED (Ẩn ngay)
    // Nếu trong sạch: Tự động APPROVED (Hiển thị ngay lập tức)
    const initialStatus = isProfane ? 'REJECTED' : 'APPROVED';

    const newReview = await prisma.review.create({
      data: {
        productId: Number(productId),
        userId: userId ? Number(userId) : null,
        userName: customerName,
        userPhone: customerPhone,
        rating: Number(rating),
        comment: reviewText,
        status: initialStatus
      }
    });

    if (isProfane) {
      console.warn(`[Auto-Moderation] Ẩn đánh giá #${newReview.id} do chứa từ cấm:`, matchedWords);
      res.status(201).json({
        success: true,
        message: "Đánh giá của bạn đã được ghi nhận và đang chờ kiểm duyệt nội dung.",
        data: {
          ...newReview,
          userPhone: maskPhoneNumber(newReview.userPhone)
        }
      });
      return;
    }

    res.status(201).json({
      success: true,
      message: "Cảm ơn bạn đã đánh giá sản phẩm!",
      data: {
        ...newReview,
        userPhone: maskPhoneNumber(newReview.userPhone)
      }
    });
  } catch (error) {
    console.error("Lỗi gửi đánh giá:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi gửi đánh giá" });
  }
};

// ============================================================================
// 3. ADMIN API: LẤY DANH SÁCH QUẢN TRỊ ĐÁNH GIÁ (KÈM BỘ LỌC TABS & SEARCH)
// ============================================================================
export const getAdminReviews = async (req: Request, res: Response): Promise<void> => {
  try {
    const statusParam = (req.query.status as string) || 'ALL';
    const search = (req.query.search as string || '').trim();
    const ratingParam = req.query.rating ? Number(req.query.rating) : null;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 12;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Lọc theo Tab Status
    if (statusParam !== 'ALL') {
      where.status = statusParam;
    }

    // Lọc theo số sao
    if (ratingParam && ratingParam >= 1 && ratingParam <= 5) {
      where.rating = ratingParam;
    }

    // Tìm kiếm đa năng: Tên khách, SĐT, comment, hoặc tên sản phẩm
    if (search) {
      where.OR = [
        { userName: { contains: search, mode: 'insensitive' } },
        { userPhone: { contains: search, mode: 'insensitive' } },
        { comment: { contains: search, mode: 'insensitive' } },
        { product: { name: { contains: search, mode: 'insensitive' } } }
      ];
    }

    // Đếm số lượng tổng thể cho các Tabs
    const [allCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
      prisma.review.count(),
      prisma.review.count({ where: { status: 'PENDING' } }),
      prisma.review.count({ where: { status: 'APPROVED' } }),
      prisma.review.count({ where: { status: 'REJECTED' } }),
    ]);

    // Lấy dữ liệu phân trang
    const [reviews, totalFiltered] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              images: { take: 1, select: { url: true } }
            }
          },
          user: {
            select: { id: true, name: true, phone: true, email: true }
          }
        }
      }),
      prisma.review.count({ where })
    ]);

    const totalPages = Math.ceil(totalFiltered / limit) || 1;

    res.status(200).json({
      success: true,
      data: reviews,
      counts: {
        all: allCount,
        pending: pendingCount,
        approved: approvedCount,
        rejected: rejectedCount
      },
      pagination: {
        currentPage: page,
        totalPages,
        totalItems: totalFiltered,
        limit
      }
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách đánh giá Admin:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi nạp đánh giá" });
  }
};

// ============================================================================
// 4. ADMIN API: CẬP NHẬT TRẠNG THÁI ĐÁNH GIÁ (DUYỆT, ẨN, TỪ CHỐI)
// ============================================================================
export const updateReviewStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      res.status(400).json({ success: false, message: "Trạng thái không hợp lệ" });
      return;
    }

    const updated = await prisma.review.update({
      where: { id: Number(id) },
      data: { status }
    });

    res.status(200).json({
      success: true,
      message: status === 'APPROVED' ? "Đã duyệt hiển thị đánh giá" : "Đã ẩn đánh giá",
      data: updated
    });
  } catch (error) {
    console.error("Lỗi cập nhật trạng thái đánh giá:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi cập nhật trạng thái" });
  }
};

// ============================================================================
// 5. ADMIN API: XÓA VĨNH VIỄN ĐÁNH GIÁ
// ============================================================================
export const deleteReview = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    await prisma.review.delete({
      where: { id: Number(id) }
    });

    res.status(200).json({
      success: true,
      message: "Đã xóa vĩnh viễn đánh giá"
    });
  } catch (error) {
    console.error("Lỗi xóa đánh giá:", error);
    res.status(500).json({ success: false, message: "Lỗi server khi xóa đánh giá" });
  }
};
